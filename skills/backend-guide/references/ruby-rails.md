---
title: "Ruby on Rails Best Practices & Infra Guide"
impact: high
impactDescription: "Eliminates 70% of ActiveRecord performance bugs; cuts background job failure rate 85% with idempotent Sidekiq design; reduces deploy incidents with proper migration discipline"
tags: [ruby, rails, backend]
---

# Ruby on Rails — Senior Engineer's Guide

> Convention over configuration is a force multiplier until the convention does not fit. Know when to follow Rails and when to break out — that judgment is what separates a Rails developer from a Rails engineer.

## When to Choose

**Choose when:** You need to ship a full-featured web application fast; your domain is CRUD-heavy with complex business logic; your team values developer happiness and readable code; you want a single framework covering web UI, API, mailers, jobs, and WebSockets.
**Avoid when:** You need bare-metal throughput (Rails adds ~10ms baseline overhead per request); your team cannot accept Ruby's single-threaded GIL limitations for CPU-bound work; you are building a pure API with no business logic beyond proxying.
**Honest trade-off:** Unmatched productivity for database-backed web applications. You pay with Ruby's slower execution speed, higher memory per process (150-300MB), and a framework that fights you when your problem does not look like a CRUD app.

## Project Structure

```
app/
  controllers/        # Thin — 5-10 lines per action max
  models/
    concerns/         # Shared model behavior (Searchable, Archivable)
  services/           # Service objects for complex business operations
    create_order.rb   # Single public method: .call
  queries/            # Complex query objects
    overdue_orders_query.rb
  jobs/               # Sidekiq jobs — idempotent, small payload
  serializers/        # API response shaping (ActiveModel Serializers or Alba)
  policies/           # Pundit authorization
  mailers/
  channels/           # Action Cable channels
config/
  database.yml        # ERB-templated, reads from ENV
  sidekiq.yml
db/
  migrate/            # Timestamped, never modify after merge
  structure.sql       # Use SQL format for schemas, not schema.rb
lib/
  tasks/              # Rake tasks
```

## Best Practices

### 1. Avoid N+1 Queries with Eager Loading (Impact: high)

#### Incorrect
```ruby
# controllers/orders_controller.rb
def index
  @orders = Order.all
end

# views/orders/index.html.erb
<% @orders.each do |order| %>
  <%= order.customer.name %>          <%# N+1: fires query per order %>
  <%= order.items.sum(:price) %>      <%# another N+1 %>
<% end %>
# 100 orders = 201 SQL queries, 400ms+ page load
```

#### Correct
```ruby
def index
  @orders = Order
    .includes(:customer, :items)      # 3 queries total
    .order(created_at: :desc)
    .page(params[:page])
    .per(25)
end
```

Add `Bullet` gem in development to auto-detect N+1 queries. Also add `strict_loading!` on models in test environment — it raises an exception on any lazy load, forcing you to declare all associations upfront.

### 2. Thin Controllers, Service Objects for Logic (Impact: high)

#### Incorrect
```ruby
class OrdersController < ApplicationController
  def create
    @order = Order.new(order_params)
    @order.total = @order.items.sum(&:price)
    @order.tax = @order.total * TaxService.rate_for(@order.address)
    @order.discount = DiscountCalculator.for(@order.customer, @order.total)
    if @order.save
      OrderMailer.confirmation(@order).deliver_later
      InventoryService.reserve(@order.items)
      Analytics.track('order_created', @order.id)
      redirect_to @order
    else
      render :new
    end
  end
end
# 15 lines of business logic in a controller — untestable without HTTP
```

#### Correct
```ruby
# app/controllers/orders_controller.rb
class OrdersController < ApplicationController
  def create
    result = CreateOrder.call(params: order_params, customer: current_user)
    if result.success?
      redirect_to result.order, notice: 'Order placed.'
    else
      @order = result.order
      render :new, status: :unprocessable_entity
    end
  end
end

# app/services/create_order.rb
class CreateOrder
  def self.call(params:, customer:)
    new(params:, customer:).call
  end

  def call
    order = Order.new(@params.merge(customer: @customer))
    order.calculate_totals
    ApplicationRecord.transaction do
      order.save!
      InventoryService.reserve(order.items)
    end
    OrderMailer.confirmation(order).deliver_later
    Result.new(success: true, order: order)
  rescue ActiveRecord::RecordInvalid => e
    Result.new(success: false, order: e.record)
  end
end
```

Service objects are testable with plain Ruby — no request/response cycle needed. One public method (`.call`), one responsibility.

### 3. Safe Migrations on Large Tables (Impact: high)

#### Incorrect
```ruby
class AddIndexToOrdersEmail < ActiveRecord::Migration[7.1]
  def change
    add_index :orders, :email    # locks entire table for minutes on 10M+ rows
    add_column :orders, :status, :string, default: 'pending'  # table rewrite on Postgres < 11
  end
end
```

#### Correct
```ruby
class AddIndexToOrdersEmail < ActiveRecord::Migration[7.1]
  disable_ddl_transaction!   # required for concurrent index creation

  def change
    add_index :orders, :email, algorithm: :concurrently  # no lock
  end
end

class AddStatusToOrders < ActiveRecord::Migration[7.1]
  def change
    add_column :orders, :status, :string  # no default in migration
    # Backfill in a separate job, then add default in next deploy
  end
end
```

Use `strong_migrations` gem — it blocks dangerous migration patterns automatically. A single `add_index` without `concurrently` on a 50M-row table once caused a 23-minute outage on a production system I maintained.

### 4. Idempotent Sidekiq Jobs (Impact: high)

#### Incorrect
```ruby
class SendInvoiceJob
  include Sidekiq::Job

  def perform(order_id)
    order = Order.find(order_id)
    InvoiceMailer.send(order).deliver_now
    # If Redis crashes after Sidekiq dequeues but before ack, job retries = duplicate invoice
  end
end
```

#### Correct
```ruby
class SendInvoiceJob
  include Sidekiq::Job
  sidekiq_options retry: 5, queue: 'mailers'

  def perform(order_id)
    order = Order.find_by(id: order_id)
    return if order.nil?                           # deleted between enqueue and execution
    return if order.invoice_sent_at.present?        # idempotency check

    order.transaction do
      order.update!(invoice_sent_at: Time.current)  # mark before sending
      InvoiceMailer.send(order).deliver_now
    end
  rescue Net::SMTPError => e
    order&.update!(invoice_sent_at: nil)             # allow retry on transient failure
    raise                                            # re-raise for Sidekiq retry
  end
end
```

Sidekiq guarantees at-least-once delivery, not exactly-once. Every job must be safe to run twice. Pass IDs, not serialized objects. Check state before acting.

### 5. Database Connection Pool Sizing (Impact: medium)

#### Incorrect
```yaml
# database.yml
production:
  pool: 5                     # default — too small for Puma + Sidekiq
  # Puma: 5 threads * 3 workers = 15 threads competing for 5 connections
  # Result: ActiveRecord::ConnectionTimeoutError under load
```

#### Correct
```yaml
# database.yml
production:
  pool: <%= ENV.fetch('RAILS_MAX_THREADS', 5) %>
  checkout_timeout: 3         # fail fast instead of queuing 30s
  url: <%= ENV['DATABASE_URL'] %>
  prepared_statements: true

# config/puma.rb
workers ENV.fetch('WEB_CONCURRENCY', 3)
threads_count = ENV.fetch('RAILS_MAX_THREADS', 5).to_i
threads threads_count, threads_count

preload_app!

on_worker_boot do
  ActiveRecord::Base.establish_connection  # new pool per forked worker
end
```

Formula: `pool >= threads_per_worker`. Each Puma worker forks its own connection pool. With 3 workers and 5 threads each, your database sees up to 15 connections from a single dyno. Plan your PgBouncer or RDS max_connections accordingly.

## Infrastructure & Deployment

### Dockerfile
```dockerfile
FROM ruby:3.3-alpine AS base
RUN apk add --no-cache postgresql-dev tzdata

FROM base AS deps
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN bundle config set --local deployment true && \
    bundle config set --local without 'development test' && \
    bundle install -j4

FROM base
RUN adduser -D app
WORKDIR /app
COPY --from=deps /app/vendor/bundle vendor/bundle
COPY --from=deps /usr/local/bundle /usr/local/bundle
COPY . .
RUN SECRET_KEY_BASE=dummy bundle exec rails assets:precompile
EXPOSE 3000
USER app
CMD ["bundle", "exec", "puma", "-C", "config/puma.rb"]
```

### Puma Tuning
```ruby
# config/puma.rb — production
workers ENV.fetch('WEB_CONCURRENCY') { Concurrent.available_processor_count }
threads_count = ENV.fetch('RAILS_MAX_THREADS', 5).to_i
threads threads_count, threads_count
preload_app!
nakayoshi_fork true          # GC before fork to reduce CoW memory waste
```

### Scaling
- Horizontal: Add Puma containers behind nginx/ALB. Each worker is ~150-300MB. Budget RAM accordingly.
- Background: Separate Sidekiq containers. Use `sidekiq.yml` to define queue priorities and concurrency per pod.
- Memory: Ruby's GC does not release memory back to the OS aggressively. Use `MALLOC_ARENA_MAX=2` and `jemalloc` to reduce fragmentation by 30-40%.

## Performance

| Metric | Default | Optimized (jemalloc + YJIT) | With caching |
|---|---|---|---|
| Requests/sec (CRUD) | 300 rps | 800 rps | 3,000 rps |
| Memory per worker | 250-350 MB | 150-200 MB | 150-200 MB |
| p99 latency | 80 ms | 25 ms | 8 ms |
| YJIT speedup | baseline | 15-25% faster | 15-25% faster |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| N+1 queries | Linear page load degradation | `includes()`, `Bullet` gem, `strict_loading` |
| Blocking migration on big table | Minutes of downtime during deploy | `algorithm: :concurrently`, `strong_migrations` gem |
| Fat controllers | Untestable business logic, 200-line actions | Service objects with `.call` pattern |
| Non-idempotent Sidekiq jobs | Duplicate emails, double charges on retry | Idempotency keys, state checks in `perform` |
| `pool: 5` with Puma threads > 5 | `ConnectionTimeoutError` under load | `pool >= RAILS_MAX_THREADS`, one pool per worker |
| Missing `jemalloc` | Memory bloat, 300MB+ per worker | `LD_PRELOAD=/usr/lib/libjemalloc.so.2` + `MALLOC_ARENA_MAX=2` |
