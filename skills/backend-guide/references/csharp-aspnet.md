---
title: "ASP.NET Core Best Practices & Infra Guide"
impact: high
impactDescription: "Reduces p99 latency 50% with proper async/await; cuts memory leaks by eliminating captured HttpContext; handles 100k+ rps on Kestrel with correct pipeline ordering"
tags: [csharp, aspnet-core, backend]
---

# ASP.NET Core — Senior Engineer's Guide

> ASP.NET Core is the quiet workhorse — it wins no hype contests but consistently tops TechEmpower benchmarks. Respect the middleware pipeline and it will repay you with throughput.

## When to Choose

**Choose when:** Your org runs Azure or Windows Server; you need a single framework for REST, gRPC, SignalR, and Blazor; your team values strong typing and IDE tooling; performance matters and you cannot afford Go's ecosystem gaps.
**Avoid when:** Your team is Linux-only and allergic to Microsoft; you are building a quick prototype and cannot wait for compilation; your deployment target is AWS Lambda (cold starts hurt).
**Honest trade-off:** Excellent performance and a mature ecosystem. The cost is a steeper learning curve than Express/Flask, verbose ceremony in Controllers, and a historically Windows-centric community that can bias library choices.

## Project Structure

```
src/
  Api/
    Program.cs                # Minimal hosting, service registration
    Endpoints/                # Minimal API endpoint groups (or Controllers/)
      OrderEndpoints.cs
    Middleware/
      CorrelationIdMiddleware.cs
    Filters/
      ValidationFilter.cs
  Domain/
    Entities/
      Order.cs
    ValueObjects/
    Interfaces/
      IOrderRepository.cs
  Infrastructure/
    Persistence/
      AppDbContext.cs
      OrderRepository.cs
      Migrations/             # EF Core migrations — source controlled
    ExternalServices/
      PaymentClient.cs
  Application/
    Services/
      OrderService.cs
    DTOs/
      OrderResponse.cs
```

## Best Practices

### 1. Async All the Way Down (Impact: high)

#### Incorrect
```csharp
public OrderResponse GetOrder(int id)
{
    var order = _context.Orders.FindAsync(id).Result;  // .Result blocks thread pool thread
    return OrderResponse.From(order);                   // deadlock under load
}
```

#### Correct
```csharp
public async Task<OrderResponse> GetOrderAsync(int id, CancellationToken ct)
{
    var order = await _context.Orders
        .AsNoTracking()
        .FirstOrDefaultAsync(o => o.Id == id, ct)
        ?? throw new NotFoundException($"Order {id}");
    return OrderResponse.From(order);
}
```

Calling `.Result` or `.Wait()` on a Task inside an ASP.NET handler consumes a ThreadPool thread and blocks it. Under load, you exhaust the pool and every request queues. This is the number one production ASP.NET incident I have debugged — always `await`, always pass `CancellationToken`.

### 2. Minimal API Over Controllers for Microservices (Impact: medium)

#### Incorrect
```csharp
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(int id) { ... }
    // 50 lines of ceremony for a 3-endpoint microservice
}
```

#### Correct
```csharp
// Endpoints/OrderEndpoints.cs
public static class OrderEndpoints
{
    public static void MapOrderEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/orders")
            .RequireAuthorization()
            .WithTags("Orders");

        group.MapGet("/{id}", GetOrder);
        group.MapPost("/", CreateOrder);
    }

    private static async Task<Results<Ok<OrderResponse>, NotFound>> GetOrder(
        int id, IOrderService service, CancellationToken ct)
    {
        var order = await service.GetAsync(id, ct);
        return order is not null ? TypedResults.Ok(order) : TypedResults.NotFound();
    }
}
```

Minimal APIs have measurably lower overhead — no controller activation, no model binding pipeline. For microservices with under 20 endpoints, they are strictly better. Use Controllers when you need complex model binding or action filters on a large API surface.

### 3. EF Core Query Optimization (Impact: high)

#### Incorrect
```csharp
var orders = await _context.Orders
    .Include(o => o.Items)
    .Include(o => o.Customer)
    .ToListAsync(ct);
// Loads ALL orders with ALL items and ALL customers into memory
// 10k orders * 50 items = 500k objects tracked by change tracker
```

#### Correct
```csharp
var orders = await _context.Orders
    .AsNoTracking()                           // no change tracking overhead
    .Where(o => o.CreatedAt > cutoff)         // filter first
    .Select(o => new OrderSummaryDto           // project only needed columns
    {
        Id = o.Id,
        Total = o.Items.Sum(i => i.Price),
        CustomerName = o.Customer.Name
    })
    .Take(50)                                  // page results
    .ToListAsync(ct);
```

Every entity loaded into the change tracker costs ~1KB of overhead for snapshot diffing. On a list endpoint returning 1,000 rows, that is 1MB of pure overhead per request. Use `AsNoTracking()` for reads, `Select()` to project, and always paginate.

### 4. Middleware Pipeline Ordering (Impact: high)

#### Incorrect
```csharp
app.UseAuthorization();
app.UseAuthentication();     // auth happens AFTER authz — every request is unauthorized
app.UseRateLimiting();       // rate limiting after auth — attackers bypass it
```

#### Correct
```csharp
app.UseExceptionHandler();          // 1. catch everything
app.UseHsts();                      // 2. security headers
app.UseRateLimiting();              // 3. reject floods BEFORE auth work
app.UseAuthentication();            // 4. who are you
app.UseAuthorization();             // 5. what can you do
app.UseResponseCompression();       // 6. compress outgoing
app.MapEndpoints();                 // 7. route to handler
```

Middleware executes in registration order. Swapping Authentication and Authorization is a silent misconfiguration that makes every endpoint return 401. I have seen this deployed to production and survive for weeks because integration tests used a test auth bypass.

### 5. Proper DI Lifetime Scopes (Impact: medium)

#### Incorrect
```csharp
builder.Services.AddSingleton<OrderService>();     // singleton holds scoped DbContext
builder.Services.AddScoped<AppDbContext>();         // disposed after request — but singleton still references it
// "Cannot access a disposed object" after first request
```

#### Correct
```csharp
builder.Services.AddScoped<AppDbContext>();         // per-request
builder.Services.AddScoped<IOrderRepository, OrderRepository>();  // per-request
builder.Services.AddScoped<IOrderService, OrderService>();        // per-request
builder.Services.AddSingleton<ICacheService, RedisCacheService>(); // truly stateless
// Rule: never inject Scoped into Singleton
```

ASP.NET Core's DI container does not prevent captive dependency errors at registration time. Enable `ValidateScopes` and `ValidateOnBuild` in development to catch these immediately: `builder.Host.UseDefaultServiceProvider(o => { o.ValidateScopes = true; o.ValidateOnBuild = true; });`

## Infrastructure & Deployment

### Dockerfile
```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src
COPY *.csproj .
RUN dotnet restore --runtime linux-musl-x64
COPY . .
RUN dotnet publish -c Release -o /app --no-restore --self-contained \
    -p:PublishTrimmed=true -p:PublishSingleFile=true

FROM mcr.microsoft.com/dotnet/runtime-deps:9.0-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
USER app
ENTRYPOINT ["./Api"]
```

### Scaling
- Kestrel handles 100k+ rps on a single instance with proper async code. It is not the bottleneck — your database is.
- Scale horizontally with zero session state. Use Redis for distributed cache and Data Protection key ring.
- For Azure: Container Apps for microservices, App Service for monoliths. Avoid Azure Functions for latency-sensitive paths (cold start 2-8s).

## Performance

| Metric | Default | Optimized | AOT Published |
|---|---|---|---|
| Cold start | 2-4s | 1-2s | 0.1-0.5s |
| RSS memory | 80-150 MB | 50-100 MB | 20-40 MB |
| p99 latency (CRUD) | 8 ms | 3 ms | 4 ms |
| Max throughput | 50k rps | 120k rps | 90k rps |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| `.Result` / `.Wait()` in async path | ThreadPool starvation, deadlock | `await` all the way, pass `CancellationToken` |
| Captive dependency (Scoped in Singleton) | `ObjectDisposedException` in prod | `ValidateScopes = true` in dev |
| Missing `AsNoTracking()` on reads | 30-40% higher memory, slower queries | Always use for read-only paths |
| Middleware order wrong | Silent auth bypass or rate limit skip | Follow the canonical pipeline order |
| No health check endpoint | K8s restarts healthy pods | `app.MapHealthChecks("/healthz")` |
| Logging PII with default Serilog | GDPR violation, audit failure | Destructure policies, masking enricher |
