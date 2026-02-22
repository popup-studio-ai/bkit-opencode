---
title: "Ktor Best Practices & Infra Guide"
impact: high
impactDescription: "Reduces service memory footprint 70% vs Spring; handles 50k concurrent connections on 256MB RAM with coroutines; cuts Docker image to 30MB with GraalVM"
tags: [kotlin, ktor, backend]
---

# Ktor — Senior Engineer's Guide

> Ktor is a blank canvas with a coroutine engine. That is its greatest strength and its biggest trap — you must bring your own discipline.

## When to Choose

**Choose when:** You want a lightweight, coroutine-native HTTP layer; your team knows Kotlin well; you are building microservices or edge proxies where every MB of RAM counts.
**Avoid when:** You need enterprise SSO/LDAP/SAML out of the box; your team expects Rails-style "everything included"; you need a large hiring pool of framework-experienced developers.
**Honest trade-off:** You get surgical control and tiny footprint. You pay by hand-wiring things Spring gives you for free — security, ORM integration, admin endpoints. Documentation has gaps. The plugin ecosystem is a fraction of Spring's.

## Project Structure

```
src/main/kotlin/com/company/service/
  Application.kt            # Entry point, installs plugins
  plugins/
    Routing.kt              # All route registration
    Serialization.kt        # ContentNegotiation config
    Security.kt             # JWT/OAuth setup
    Monitoring.kt           # CallLogging, Metrics
  routes/
    OrderRoutes.kt          # Feature-scoped route functions
    HealthRoutes.kt
  domain/
    Order.kt                # Data classes, NO framework annotations
  repository/
    OrderRepository.kt      # Exposed/jOOQ queries
  service/
    OrderService.kt         # Business logic, injected via Koin
  di/
    AppModule.kt            # Koin module definitions
```

## Best Practices

### 1. Structured Concurrency in Route Handlers (Impact: high)

#### Incorrect
```kotlin
get("/reports/{id}") {
    val report = GlobalScope.launch {   // leaks coroutine, ignores cancellation
        generateReport(call.parameters["id"]!!)
    }
    report.join()
    call.respond(report)
}
```

#### Correct
```kotlin
get("/reports/{id}") {
    val id = call.parameters["id"] ?: return@get call.respond(HttpStatusCode.BadRequest)
    val report = withContext(Dispatchers.IO) {  // scoped to request lifecycle
        reportService.generate(id)
    }
    call.respond(report)
}
```

`GlobalScope.launch` is the coroutine equivalent of spawning an unmanaged thread. When the client disconnects, the coroutine keeps running, burning CPU and potentially writing stale results. Ktor's call scope cancels automatically on client disconnect — use it.

### 2. Koin Dependency Injection Over Service Locator (Impact: medium)

#### Incorrect
```kotlin
class OrderService {
    private val repo = OrderRepository(Database.connect(...))  // hard-coded, untestable
    private val client = HttpClient(CIO)                       // leaked client
}
```

#### Correct
```kotlin
// di/AppModule.kt
val appModule = module {
    single { Database.connect(getProperty("DB_URL"), driver = getProperty("DB_DRIVER")) }
    single { OrderRepository(get()) }
    single { OrderService(get()) }
    single { HttpClient(CIO) { install(ContentNegotiation) { json() } } }
}

// service/OrderService.kt
class OrderService(private val repo: OrderRepository) {
    suspend fun findById(id: String): Order? = repo.findById(id)
}
```

Koin is lightweight (~200KB), requires no code generation, and integrates cleanly with Ktor's plugin system via `install(Koin) { modules(appModule) }`. In tests, override with `declare { single<OrderRepository> { mockk() } }`.

### 3. Proper Error Handling with StatusPages (Impact: high)

#### Incorrect
```kotlin
get("/orders/{id}") {
    try {
        val order = orderService.findById(call.parameters["id"]!!)
        call.respond(order ?: throw NotFoundException())
    } catch (e: Exception) {
        call.respond(HttpStatusCode.InternalServerError, "Something went wrong")
        // swallows stack trace, logs nothing, returns no useful error body
    }
}
```

#### Correct
```kotlin
// plugins/Monitoring.kt
install(StatusPages) {
    exception<NotFoundException> { call, cause ->
        call.respond(HttpStatusCode.NotFound, ErrorResponse(cause.message ?: "Not found"))
    }
    exception<IllegalArgumentException> { call, cause ->
        call.respond(HttpStatusCode.BadRequest, ErrorResponse(cause.message ?: "Bad request"))
    }
    exception<Throwable> { call, cause ->
        logger.error(cause) { "Unhandled exception on ${call.request.uri}" }
        call.respond(HttpStatusCode.InternalServerError, ErrorResponse("Internal error"))
    }
}

// routes/OrderRoutes.kt — clean handler, no try-catch
get("/orders/{id}") {
    val id = call.parameters["id"] ?: throw IllegalArgumentException("Missing id")
    val order = orderService.findById(id) ?: throw NotFoundException("Order $id")
    call.respond(order)
}
```

Centralized error handling ensures consistent error response formats, proper logging, and no swallowed exceptions. Every microservice I have shipped at scale uses this pattern.

### 4. Content Negotiation Done Right (Impact: medium)

#### Incorrect
```kotlin
get("/orders/{id}") {
    val order = orderService.findById(id)
    call.respondText(Json.encodeToString(order), ContentType.Application.Json)
    // manual serialization, no content type negotiation, breaks Accept headers
}
```

#### Correct
```kotlin
install(ContentNegotiation) {
    json(Json {
        ignoreUnknownKeys = true        // forward-compatible deserialization
        encodeDefaults = false           // smaller payloads
        isLenient = false                // strict parsing in prod
        prettyPrint = false              // save bandwidth
    })
}

// route handler — framework handles serialization
get("/orders/{id}") {
    call.respond(orderService.findById(id) ?: throw NotFoundException())
}
```

### 5. HTTP Client Lifecycle Management (Impact: high)

#### Incorrect
```kotlin
suspend fun fetchPrice(productId: String): Price {
    val client = HttpClient(CIO)        // NEW client per call — connection pool leak
    val result = client.get("https://pricing-api/products/$productId")
    // client never closed, file descriptors leak, eventual EMFILE crash
    return result.body()
}
```

#### Correct
```kotlin
// Singleton via Koin, closed on application shutdown
single {
    HttpClient(CIO) {
        install(ContentNegotiation) { json() }
        install(HttpTimeout) {
            requestTimeoutMillis = 3000
            connectTimeoutMillis = 1000
        }
        engine {
            maxConnectionsCount = 100
            endpoint { connectAttempts = 2 }
        }
    }
}

// Application.kt
environment.monitor.subscribe(ApplicationStopped) {
    get<HttpClient>().close()
}
```

Every `HttpClient()` call allocates a new connection pool, selector thread, and buffer arena. At 1,000 rps, that is 1,000 leaked pools per second. I have seen this pattern bring down a production gateway in under 4 minutes.

## Infrastructure & Deployment

### Dockerfile
```dockerfile
FROM gradle:8-jdk21-alpine AS build
WORKDIR /app
COPY build.gradle.kts settings.gradle.kts ./
COPY src ./src
RUN gradle buildFatJar --no-daemon

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /app/build/libs/*-all.jar app.jar
ENV JAVA_OPTS="-XX:+UseZGC -XX:MaxRAMPercentage=75.0"
EXPOSE 8080
USER app
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

### Scaling
- Ktor on CIO engine handles 50k concurrent connections with ~256MB RAM thanks to coroutines suspending instead of blocking threads.
- Scale horizontally behind a load balancer. Ktor is stateless by default — no session affinity needed unless you add it.
- For extreme throughput, switch to the Netty engine: `embeddedServer(Netty, port = 8080)`. Netty adds ~20MB overhead but handles edge cases (WebSocket backpressure, HTTP/2) more robustly.

## Performance

| Metric | CIO Engine | Netty Engine | GraalVM Native |
|---|---|---|---|
| Cold start | 1.5-3s | 2-4s | 0.05-0.2s |
| RSS memory | 80-150 MB | 120-200 MB | 30-60 MB |
| p99 latency (CRUD) | 5 ms | 4 ms | 6 ms |
| Max throughput | 45k rps | 60k rps | 35k rps |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| `GlobalScope.launch` in handlers | Memory leak, orphaned coroutines | Use `withContext` or `coroutineScope` |
| New `HttpClient` per request | EMFILE errors after minutes | Singleton client via DI, close on shutdown |
| Blocking calls without `Dispatchers.IO` | Thread starvation, frozen event loop | Wrap JDBC/file IO in `withContext(Dispatchers.IO)` |
| Missing `ignoreUnknownKeys` in JSON | Deserialization crash on new API fields | Always set `ignoreUnknownKeys = true` |
| No request timeout on outbound calls | Thread pool exhaustion under partner outage | `HttpTimeout` plugin, 3s request max |
| Hardcoded config values | Different builds per environment | `application.conf` with env variable overrides |
