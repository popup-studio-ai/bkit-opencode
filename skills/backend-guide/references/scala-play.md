---
title: "Scala Play/Akka HTTP Best Practices & Infra Guide"
impact: medium
impactDescription: "Play/Akka powers LinkedIn-scale traffic. Improper Future composition causes thread pool starvation that silently degrades throughput by 80%."
tags: [scala, play, akka, jvm, backend]
---

# Scala Play/Akka HTTP — Senior Engineer's Guide

> Type safety is not overhead — it's the production insurance policy your 3am self will thank you for.

## When to Choose

**Choose when:** High-throughput streaming (Akka Streams), type-safe API contracts, JVM ecosystem integration (Spark, Kafka), teams with FP experience.
**Avoid when:** Small team without Scala experience, simple CRUD app (use Go or Node), need fastest cold-start (JVM penalty), tight deadline with junior devs.
**Honest trade-off:** Steep learning curve, slow compile times, complex build tooling (sbt). The type system catches bugs at compile time but demands more upfront design.

## Project Structure

```
app/
├── controllers/
│   ├── UserController.scala      # Thin HTTP layer
│   └── HealthController.scala
├── services/
│   ├── UserService.scala         # Business logic (trait + impl)
│   └── NotificationService.scala
├── repositories/
│   ├── UserRepository.scala      # Slick/Doobie DB access
│   └── package.scala             # Shared repo types
├── models/
│   ├── User.scala                # Domain models + JSON codecs
│   └── Errors.scala              # Typed error ADT
├── modules/
│   └── AppModule.scala           # Guice/MacWire DI bindings
├── filters/
│   └── LoggingFilter.scala       # Request/response logging
└── utils/
    └── FutureOps.scala           # Future extension methods
conf/
├── application.conf              # Typesafe config (HOCON)
├── routes                        # Play route definitions
└── logback.xml
```

## Best Practices

### Typed Errors Over Thrown Exceptions (Impact: high)

#### Incorrect
```scala
// Throwing exceptions for control flow — invisible to callers, untyped
class UserService @Inject()(repo: UserRepository) {
  def getUser(id: Long): Future[User] = {
    repo.findById(id).map {
      case Some(user) => user
      case None => throw new RuntimeException(s"User $id not found")  // caller has no idea
    }
  }
}
```

#### Correct
```scala
// ADT errors — compiler forces callers to handle every case
sealed trait ServiceError
case class NotFound(entity: String, id: String) extends ServiceError
case class ValidationFailed(errors: NonEmptyList[String]) extends ServiceError
case class Unauthorized(reason: String) extends ServiceError

class UserService @Inject()(repo: UserRepository)(implicit ec: ExecutionContext) {
  def getUser(id: Long): Future[Either[ServiceError, User]] =
    repo.findById(id).map {
      case Some(user) => Right(user)
      case None       => Left(NotFound("User", id.toString))
    }
}

// Controller pattern-matches exhaustively
def show(id: Long) = Action.async {
  userService.getUser(id).map {
    case Right(user)              => Ok(Json.toJson(user))
    case Left(NotFound(_, _))     => NotFound(errorJson("not_found"))
    case Left(Unauthorized(r))    => Forbidden(errorJson(r))
    case Left(ValidationFailed(e))=> BadRequest(errorJson(e.toList))
  }
}
```

### Execution Context Isolation (Impact: high)

#### Incorrect
```scala
// Using the default execution context for everything — blocking DB calls starve HTTP threads
class UserController @Inject()(userService: UserService)(implicit ec: ExecutionContext)
    extends AbstractController {
  def list() = Action.async {
    // DB call runs on Play's default pool — blocks request handling
    userService.listAll().map(users => Ok(Json.toJson(users)))
  }
}
```

#### Correct
```scala
// Dedicated execution context for blocking I/O
// In application.conf:
// blocking-io-dispatcher {
//   type = Dispatcher
//   executor = "thread-pool-executor"
//   thread-pool-executor { fixed-pool-size = 32 }
// }

class UserRepository @Inject()(db: Database)(
    implicit @Named("blocking-io") ec: ExecutionContext
) {
  def findAll(): Future[Seq[User]] = Future {
    db.withConnection { implicit conn =>
      SQL("SELECT * FROM users WHERE active = true").as(userParser.*)
    }
  }  // Runs on dedicated blocking pool, not Play's default
}

// Play's default EC handles only non-blocking async work
class UserController @Inject()(
    userService: UserService
)(implicit ec: ExecutionContext) extends AbstractController {
  def list() = Action.async {
    userService.listAll().map(users => Ok(Json.toJson(users)))
    // This .map runs on default EC (fast, non-blocking)
  }
}
```

### Akka Streams for Backpressured Pipelines (Impact: high)

#### Incorrect
```scala
// Loading entire dataset into memory — OOM on large tables
def exportUsers() = Action.async {
  repo.findAll().map { users =>  // 10M rows → OOM
    val csv = users.map(_.toCsvRow).mkString("\n")
    Ok(csv).as("text/csv")
  }
}
```

#### Correct
```scala
// Stream with backpressure — constant memory regardless of dataset size
def exportUsers() = Action {
  val source: Source[User, _] = Slick.source(
    Users.filter(_.active === true).result
  )

  val csvFlow = Flow[User]
    .map(u => ByteString(s"${u.id},${u.name},${u.email}\n"))

  Ok.chunked(source.via(csvFlow))
    .as("text/csv")
    .withHeaders("Content-Disposition" -> "attachment; filename=users.csv")
  // Streams 10M rows in ~50MB memory
}
```

### Configuration with Typesafe Validation (Impact: medium)

#### Incorrect
```scala
val dbHost = sys.env.getOrElse("DB_HOST", "localhost")  // silent wrong default in prod
val dbPort = sys.env("DB_PORT").toInt                    // NumberFormatException at runtime
```

#### Correct
```scala
import pureconfig._
import pureconfig.generic.auto._

case class DbConfig(host: String, port: Int, name: String, poolSize: Int)
case class AppConfig(db: DbConfig, http: HttpConfig, auth: AuthConfig)

// Fails at startup with clear error messages if config is missing/malformed
val config = ConfigSource.default.loadOrThrow[AppConfig]
// "Key not found: 'db.host'" — not a runtime NPE at 3am
```

## Infrastructure & Deployment

### Dockerfile (multi-stage with sbt-native-packager)
```dockerfile
FROM sbt:eclipse-temurin-21 AS builder
WORKDIR /app
COPY build.sbt project/ ./project/
COPY project/build.properties project/plugins.sbt ./project/
RUN sbt update
COPY . .
RUN sbt dist

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/universal/*.zip ./app.zip
RUN unzip app.zip && rm app.zip && mv my-app-*/* .
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app
USER app
EXPOSE 9000
HEALTHCHECK --interval=30s CMD wget -q -O /dev/null http://localhost:9000/health || exit 1
ENTRYPOINT ["bin/my-app", "-Dpidfile.path=/dev/null"]
```

### JVM Tuning
- **Heap:** `-Xms512m -Xmx512m` (equal min/max avoids GC pauses from resizing).
- **GC:** `-XX:+UseZGC` for low-latency, `-XX:+UseG1GC` for throughput.
- **Container-aware:** JVM 17+ auto-detects container memory. Set `-XX:MaxRAMPercentage=75`.

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| Requests/sec (JSON API) | ~30k | ~80k (Akka HTTP, tuned dispatchers) |
| P99 latency | 15ms | 3ms (ZGC, warm JIT) |
| Cold start | 5-10s | 2-3s (CRaC or GraalVM native-image) |
| Streaming throughput | 100k events/sec | 500k+/sec (Akka Streams, fused stages) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Blocking on default dispatcher | All routes timeout under load | Isolate blocking I/O to dedicated dispatcher |
| `Await.result` in async code | Thread pool deadlock | Use `map`/`flatMap`, never block Futures |
| Implicit scope confusion | Compile errors, wrong EC used | Explicit `@Named` injection for execution contexts |
| No circuit breaker on external calls | Cascading failures | Akka `CircuitBreaker` with exponential backoff |
| SBT recompiles everything | 5min build times | Use Zinc incremental, split into subprojects |
