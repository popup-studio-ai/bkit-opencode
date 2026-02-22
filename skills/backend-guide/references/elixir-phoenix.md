---
title: "Elixir/Phoenix Best Practices & Infra Guide"
impact: medium
impactDescription: "Phoenix handles 2M+ concurrent connections on a single node. Default GenServer patterns hide supervision tree bugs that crash entire subsystems in production."
tags: [elixir, phoenix, otp, beam, backend]
---

# Elixir/Phoenix — Senior Engineer's Guide

> Let it crash — but only the right process, supervised the right way.

## When to Choose

**Choose when:** Real-time features (chat, presence, IoT), massive concurrency (100k+ connections), fault-tolerant systems, soft real-time requirements.
**Avoid when:** Team has zero Erlang/functional experience, CPU-heavy number crunching (use Rust NIFs instead), rapid prototype with disposable codebase.
**Honest trade-off:** Smaller hiring pool, pattern matching learning curve, ecosystem smaller than Node/Python. BEAM VM is not the fastest at raw computation — it excels at coordination.

## Project Structure

```
lib/
├── my_app/
│   ├── application.ex         # Supervision tree root
│   ├── repo.ex                # Ecto repository
│   ├── accounts/              # Context: business logic boundary
│   │   ├── accounts.ex        # Public API for this context
│   │   ├── user.ex            # Ecto schema
│   │   └── user_token.ex
│   ├── workers/
│   │   ├── rate_limiter.ex    # GenServer
│   │   └── cache_warmer.ex    # Periodic Task
│   └── telemetry.ex           # Metrics and instrumentation
├── my_app_web/
│   ├── router.ex              # Route definitions
│   ├── endpoint.ex            # HTTP endpoint config
│   ├── controllers/
│   ├── channels/              # WebSocket channels
│   │   └── room_channel.ex
│   ├── live/                  # LiveView modules
│   │   └── dashboard_live.ex
│   └── plugs/                 # Middleware (Plug pipeline)
│       └── auth.ex
config/
├── config.exs                 # Compile-time config
├── runtime.exs                # Runtime config (12-factor)
└── prod.exs
```

## Best Practices

### Supervision Trees Over Bare GenServers (Impact: high)

#### Incorrect
```elixir
# Starting a GenServer without supervision — if it crashes, it's gone forever
defmodule MyApp.Cache do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
end

# Somewhere in application startup:
MyApp.Cache.start_link([])  # No restart strategy, no monitoring
```

#### Correct
```elixir
defmodule MyApp.Cache do
  use GenServer
  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  def init(opts), do: {:ok, %{ttl: Keyword.get(opts, :ttl, 300_000), store: %{}}}

  # Schedule periodic cleanup
  def init(state) do
    schedule_cleanup()
    {:ok, state}
  end

  defp schedule_cleanup, do: Process.send_after(self(), :cleanup, state.ttl)
end

# In application.ex — supervised with restart strategy
children = [
  MyApp.Repo,
  {MyApp.Cache, ttl: 300_000},
  {Phoenix.PubSub, name: MyApp.PubSub},
  MyAppWeb.Endpoint
]
Supervisor.start_link(children, strategy: :one_for_one)
```

### Context Boundaries for Business Logic (Impact: high)

#### Incorrect
```elixir
# Controller calling Repo directly — business logic scattered across controllers
defmodule MyAppWeb.UserController do
  def create(conn, params) do
    changeset = User.changeset(%User{}, params)
    case Repo.insert(changeset) do
      {:ok, user} ->
        Repo.insert!(%AuditLog{action: "user_created", user_id: user.id})
        MyApp.Mailer.send_welcome(user)
        json(conn, user)
    end
  end
end
```

#### Correct
```elixir
# Context module owns all business logic for the domain
defmodule MyApp.Accounts do
  def register_user(attrs) do
    Multi.new()
    |> Multi.insert(:user, User.registration_changeset(%User{}, attrs))
    |> Multi.insert(:audit, fn %{user: user} ->
      AuditLog.changeset(%AuditLog{}, %{action: "user_created", user_id: user.id})
    end)
    |> Repo.transaction()
    |> case do
      {:ok, %{user: user}} ->
        MyApp.Mailer.deliver_later(WelcomeEmail.new(user))  # Async via Oban
        {:ok, user}
      {:error, :user, changeset, _} -> {:error, changeset}
    end
  end
end

# Controller is thin — just HTTP translation
defmodule MyAppWeb.UserController do
  def create(conn, %{"user" => params}) do
    case Accounts.register_user(params) do
      {:ok, user} -> conn |> put_status(:created) |> json(%{data: user})
      {:error, changeset} -> conn |> put_status(422) |> json(%{errors: format(changeset)})
    end
  end
end
```

### Channel Authentication and Rate Limiting (Impact: high)

#### Incorrect
```elixir
defmodule MyAppWeb.RoomChannel do
  # No auth check — anyone with a socket can join any room
  def join("room:" <> room_id, _params, socket) do
    {:ok, socket}
  end

  # No rate limiting on incoming messages
  def handle_in("new_msg", %{"body" => body}, socket) do
    broadcast!(socket, "new_msg", %{body: body, user: socket.assigns.user})
    {:noreply, socket}
  end
end
```

#### Correct
```elixir
defmodule MyAppWeb.RoomChannel do
  @max_msgs_per_second 5

  def join("room:" <> room_id, _params, socket) do
    if Accounts.can_access_room?(socket.assigns.current_user, room_id) do
      send(self(), :after_join)
      {:ok, assign(socket, :room_id, room_id)}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  def handle_in("new_msg", %{"body" => body}, socket) do
    if rate_limited?(socket) do
      {:reply, {:error, %{reason: "rate_limited"}}, socket}
    else
      payload = %{body: sanitize(body), user_id: socket.assigns.current_user.id}
      broadcast!(socket, "new_msg", payload)
      {:noreply, update_rate(socket)}
    end
  end

  defp rate_limited?(socket) do
    count = Map.get(socket.assigns, :msg_count, 0)
    count >= @max_msgs_per_second
  end
end
```

### Ecto Query Composition (Impact: medium)

#### Incorrect
```elixir
# Raw SQL strings everywhere — no composability, easy SQL injection
def search_users(term) do
  Repo.query!("SELECT * FROM users WHERE name LIKE '%#{term}%'")
end
```

#### Correct
```elixir
defmodule MyApp.Accounts.UserQuery do
  import Ecto.Query

  def base, do: from(u in User, as: :user)

  def active(query), do: where(query, [user: u], u.status == :active)

  def search(query, term) when is_binary(term) do
    where(query, [user: u], ilike(u.name, ^"%#{String.replace(term, "%", "\\%")}%"))
  end

  def paginate(query, page, per_page \\ 20) do
    query |> limit(^per_page) |> offset(^((page - 1) * per_page))
  end
end

# Composable pipeline — each function returns a query
UserQuery.base() |> UserQuery.active() |> UserQuery.search("jane") |> UserQuery.paginate(1) |> Repo.all()
```

## Infrastructure & Deployment

### Dockerfile (multi-stage with releases)
```dockerfile
FROM hexpm/elixir:1.16.1-erlang-26.2.2-alpine-3.19.1 AS builder
RUN apk add --no-cache git build-base
WORKDIR /app
ENV MIX_ENV=prod
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod && mix deps.compile
COPY lib lib
COPY priv priv
COPY config config
RUN mix release

FROM alpine:3.19.1
RUN apk add --no-cache libstdc++ openssl ncurses-libs
WORKDIR /app
COPY --from=builder /app/_build/prod/rel/my_app ./
ENV PHX_SERVER=true
EXPOSE 4000
HEALTHCHECK --interval=30s CMD wget -q -O /dev/null http://localhost:4000/health || exit 1
CMD ["bin/my_app", "start"]
```

### Scaling
- **BEAM does the heavy lifting:** A single node handles 2M+ lightweight processes. Scale vertically first.
- **Distributed Erlang:** Connect nodes with `libcluster` for PubSub, distributed caches.
- **Release config:** Use `runtime.exs` for all environment variables (not `config.exs` — that's compile-time).

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| Concurrent WebSocket connections | 100k/node | 2M+/node (tune BEAM flags) |
| Request latency (JSON API) | 2-5ms | <1ms (ETS caching) |
| Memory per process | ~2KB | ~1KB (minimize state) |
| Hot code reload | Available | Zero-downtime deploys natively |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| GenServer as bottleneck | Single process serializes all calls | Use ETS for reads, GenServer for writes |
| N+1 queries in Ecto | Slow list endpoints | `Repo.preload` or `from(u in User, preload: [:posts])` |
| Missing `runtime.exs` | Config baked at compile time, env vars ignored | Move secrets to `config/runtime.exs` |
| Unbounded process mailbox | Memory grows, GC stalls | Monitor with `:erlang.process_info(pid, :message_queue_len)` |
| No Telemetry integration | Blind to performance in prod | Attach `telemetry_metrics` + Prometheus exporter |
