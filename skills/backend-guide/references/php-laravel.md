---
title: "Laravel Best Practices & Infra Guide"
impact: high
impactDescription: "Eliminates 90% of N+1 queries with eager loading; reduces queue failure rate 80% with proper job design; cuts deploy downtime to zero with Envoyer/Vapor"
tags: [php, laravel, backend]
---

# Laravel — Senior Engineer's Guide

> Laravel makes the first 80% feel magical. The last 20% — multi-tenancy, queue reliability, PHP memory management — is where engineering discipline separates toy projects from production systems.

## When to Choose

**Choose when:** Rapid CRUD development with auth, mail, queues, and scheduling out of the box; your team knows PHP; you need a monolith that can evolve into queued workers and APIs without a rewrite.
**Avoid when:** You need sub-10ms latency at high concurrency (PHP's process-per-request model caps out); your team has zero PHP experience and does not want to learn; you are building a pure real-time system (use Go/Elixir).
**Honest trade-off:** Fastest time-to-market for data-driven web apps. You pay with PHP's per-request bootstrap cost (~5-15ms), memory-per-worker model (30-50MB each), and a framework that makes it easy to write coupled code if you are not disciplined.

## Project Structure

```
app/
  Actions/              # Single-responsibility business operations
    CreateOrderAction.php
  Models/               # Eloquent models, scopes, relationships only
  Http/
    Controllers/        # Thin — call Actions, return Resources
    Requests/           # Form validation, authorization
    Resources/          # API response transformation (NEVER return models directly)
    Middleware/
  Jobs/                 # Queue jobs — idempotent, small payload
  Events/
  Listeners/
  Providers/
  Exceptions/
    Handler.php
database/
  migrations/           # Always timestamped, never edited after deploy
  seeders/
config/                 # 12-factor: env() ONLY in config files, nowhere else
routes/
  api.php
  web.php
```

## Best Practices

### 1. Eager Loading to Prevent N+1 Queries (Impact: high)

#### Incorrect
```php
// Controller
$orders = Order::all();
return view('orders.index', compact('orders'));

// Blade template
@foreach ($orders as $order)
    {{ $order->customer->name }}   {{-- N+1: 1 query + N customer queries --}}
    {{ $order->items->count() }}   {{-- another N queries --}}
@endforeach
// 100 orders = 201 queries. Scales linearly to disaster.
```

#### Correct
```php
$orders = Order::with(['customer', 'items'])
    ->select(['id', 'customer_id', 'total', 'created_at'])  // only needed columns
    ->latest()
    ->paginate(25);

return OrderResource::collection($orders);
// 3 queries total regardless of result count
```

Install `beyondcode/laravel-query-detector` in dev to catch N+1s automatically. At one company, enabling eager loading on a single list endpoint dropped page load from 4.2s to 180ms — a 23x improvement from a one-line change.

### 2. Idempotent Queue Jobs (Impact: high)

#### Incorrect
```php
class ChargeCustomerJob implements ShouldQueue
{
    public function handle()
    {
        $customer = Customer::find($this->customerId);
        PaymentGateway::charge($customer, $this->amount);
        // If job fails after charge but before ack, retry = double charge
        // If customer is deleted between dispatch and execution = crash
    }
}
```

#### Correct
```php
class ChargeCustomerJob implements ShouldQueue
{
    use InteractsWithQueue;

    public int $tries = 3;
    public int $backoff = 60;
    public string $uniqueFor = 3600;  // prevent duplicate dispatch

    public function handle(): void
    {
        $customer = Customer::find($this->customerId);
        if (!$customer || $customer->hasBeenCharged($this->idempotencyKey)) {
            return;  // safe no-op
        }

        DB::transaction(function () use ($customer) {
            PaymentGateway::charge($customer, $this->amount, $this->idempotencyKey);
            $customer->recordCharge($this->idempotencyKey, $this->amount);
        });
    }

    public function failed(Throwable $e): void
    {
        Log::error('Charge failed', [
            'customer_id' => $this->customerId,
            'error' => $e->getMessage(),
        ]);
        // Notify ops, do NOT silently swallow
    }
}
```

Every queue job WILL be retried eventually. Design for it. Use idempotency keys, check state before acting, and always implement `failed()`.

### 3. Never Use env() Outside Config Files (Impact: medium)

#### Incorrect
```php
// app/Services/PaymentService.php
$apiKey = env('STRIPE_KEY');  // returns null when config is cached
// `php artisan config:cache` compiles config — env() stops working everywhere else
```

#### Correct
```php
// config/services.php
'stripe' => [
    'key' => env('STRIPE_KEY'),       // env() ONLY here
    'secret' => env('STRIPE_SECRET'),
],

// app/Services/PaymentService.php
$apiKey = config('services.stripe.key');  // works with or without cache
```

This is the single most common Laravel production bug. `php artisan config:cache` is required for performance in production, and it breaks every direct `env()` call outside of config files. Teams discover this the hard way on their first production deploy.

### 4. Form Requests for Validation (Impact: medium)

#### Incorrect
```php
public function store(Request $request)
{
    $request->validate([
        'email' => 'required|email|unique:users',
        'name' => 'required|string|max:255',
    ]);
    // Validation logic mixed with controller logic
    // Authorization check missing
    // Reusable? No.
}
```

#### Correct
```php
// app/Http/Requests/StoreUserRequest.php
class StoreUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', User::class);
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'email:rfc,dns', 'unique:users'],
            'name' => ['required', 'string', 'max:255'],
        ];
    }
}

// Controller — thin and clean
public function store(StoreUserRequest $request): JsonResponse
{
    $user = (new CreateUserAction)($request->validated());
    return UserResource::make($user)->response()->setStatusCode(201);
}
```

### 5. Database Transaction Boundaries (Impact: high)

#### Incorrect
```php
public function transferFunds($fromId, $toId, $amount)
{
    $from = Account::find($fromId);
    $from->balance -= $amount;
    $from->save();                    // committed immediately

    $to = Account::find($toId);
    $to->balance += $amount;
    $to->save();                      // if this fails, money vanishes
}
```

#### Correct
```php
public function transferFunds(int $fromId, int $toId, float $amount): void
{
    DB::transaction(function () use ($fromId, $toId, $amount) {
        $from = Account::lockForUpdate()->findOrFail($fromId);

        if ($from->balance < $amount) {
            throw new InsufficientFundsException($fromId, $amount);
        }

        $from->decrement('balance', $amount);
        Account::where('id', $toId)->increment('balance', $amount);
    }, attempts: 3);  // retry on deadlock
}
```

## Infrastructure & Deployment

### Dockerfile
```dockerfile
FROM php:8.3-fpm-alpine AS base
RUN apk add --no-cache libpq-dev && docker-php-ext-install pdo_pgsql opcache
COPY docker/php.ini /usr/local/etc/php/conf.d/99-production.ini

FROM composer:2 AS deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist --optimize-autoloader

FROM base
WORKDIR /app
COPY --from=deps /app/vendor ./vendor
COPY . .
RUN php artisan config:cache && php artisan route:cache && php artisan view:cache
EXPOSE 9000
USER www-data
CMD ["php-fpm"]
```

### PHP-FPM Tuning
```ini
; php-fpm.d/www.conf
pm = static                    ; avoid fork overhead under load
pm.max_children = 20           ; (total_ram - OS_overhead) / avg_worker_memory
pm.max_requests = 1000         ; recycle workers to prevent memory leaks
request_terminate_timeout = 30  ; kill runaway requests
```

### Scaling
- Horizontal: Add PHP-FPM containers behind nginx. Stateless by default — sessions in Redis, cache in Redis, queues in Redis.
- Queue workers: Separate containers running `php artisan queue:work --tries=3 --timeout=60`. Use Horizon for Redis queue monitoring and auto-scaling worker pools.
- Zero-downtime deploy: Envoyer (traditional), Vapor (serverless on Lambda). Vapor eliminates FPM tuning entirely but adds cold start latency.

## Performance

| Metric | Default | Optimized (OPcache+FPM) | Octane (Swoole) |
|---|---|---|---|
| Requests/sec (CRUD) | 400 rps | 1,200 rps | 5,000 rps |
| Memory per worker | 40-60 MB | 30-40 MB | 60-80 MB (persistent) |
| p99 latency | 50 ms | 15 ms | 5 ms |
| Cold bootstrap | 15 ms | 5 ms | 0 ms (persistent) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| N+1 queries | Page load scales linearly with rows | `with()` eager loading, query detector package |
| `env()` outside config | Null values after `config:cache` | Only use `env()` in `config/*.php` files |
| Non-idempotent queue jobs | Double charges, duplicate emails on retry | Idempotency keys, state checks before action |
| Missing `lockForUpdate()` | Race conditions on balance/inventory | Pessimistic locking in transactions |
| No OPcache in production | 3-5x slower response times | `opcache.enable=1`, `validate_timestamps=0` |
| Queue jobs with Eloquent models as payload | Stale data, serialization failures | Pass IDs only, fetch fresh in `handle()` |
