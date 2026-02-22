---
title: "Swift Vapor Best Practices & Infra Guide"
impact: medium
impactDescription: "Vapor brings Swift's type safety to server-side with async/await. Incorrect Fluent ORM patterns cause N+1 queries that degrade API latency by 10x on list endpoints."
tags: [swift, vapor, server-side-swift, backend]
---

# Swift Vapor — Senior Engineer's Guide

> Swift on the server is not an experiment anymore — it's type-safe, fast, and the only option when you want one language from iOS to API.

## When to Choose

**Choose when:** Apple-ecosystem team sharing models between iOS/server, need C-level performance with memory safety, real-time WebSocket features, small-to-medium APIs.
**Avoid when:** Team has no Swift experience, need mature ORM (Fluent is growing but not Prisma/SQLAlchemy), require extensive third-party library ecosystem, Windows deployment required.
**Honest trade-off:** Smaller ecosystem than Node/Go/Python, Linux deployment requires separate build testing, Fluent ORM is less battle-tested than alternatives.

## Project Structure

```
Sources/
├── App/
│   ├── configure.swift          # App configuration
│   ├── routes.swift             # Route registration
│   ├── Controllers/
│   │   ├── UserController.swift # Route handlers
│   │   └── AuthController.swift
│   ├── Models/
│   │   ├── User.swift           # Fluent model
│   │   └── Token.swift
│   ├── DTOs/
│   │   ├── CreateUserDTO.swift  # Request/Response types
│   │   └── UserResponse.swift
│   ├── Middleware/
│   │   ├── AuthMiddleware.swift
│   │   └── RateLimitMiddleware.swift
│   ├── Migrations/
│   │   └── CreateUser.swift     # Database migrations
│   └── Services/
│       └── UserService.swift    # Business logic
├── Run/
│   └── main.swift               # Entry point
Tests/
└── AppTests/
    └── UserTests.swift
```

## Best Practices

### Async/Await Over EventLoopFuture (Impact: high)

#### Incorrect
```swift
// Old EventLoopFuture style — callback hell, hard to reason about
func getUser(_ req: Request) -> EventLoopFuture<User> {
    User.find(req.parameters.get("id"), on: req.db)
        .unwrap(or: Abort(.notFound))
        .flatMap { user in
            user.$posts.load(on: req.db).map { user }
        }
        .flatMap { user in
            user.$profile.load(on: req.db).map { user }
        }
}
```

#### Correct
```swift
// Swift concurrency — linear, readable, proper error handling
func getUser(_ req: Request) async throws -> UserResponse {
    guard let id = req.parameters.get("id", as: UUID.self) else {
        throw Abort(.badRequest, reason: "Invalid user ID")
    }

    guard let user = try await User.query(on: req.db)
        .with(\.$posts)
        .with(\.$profile)
        .filter(\.$id == id)
        .first()
    else {
        throw Abort(.notFound, reason: "User not found")
    }

    return UserResponse(from: user)  // DTO, not raw model
}
```

### Content Validation with Codable DTOs (Impact: high)

#### Incorrect
```swift
// Using the model directly — exposes internal fields, no validation
func createUser(_ req: Request) async throws -> User {
    let user = try req.content.decode(User.self)  // Accepts id, createdAt, role...
    try await user.save(on: req.db)
    return user  // Leaks password hash, internal timestamps
}
```

#### Correct
```swift
// Separate DTOs for input and output — validate at the boundary
struct CreateUserRequest: Content, Validatable {
    let email: String
    let name: String
    let password: String

    static func validations(_ validations: inout Validations) {
        validations.add("email", as: String.self, is: .email)
        validations.add("name", as: String.self, is: !.empty && .count(1...100))
        validations.add("password", as: String.self, is: .count(8...))
    }
}

struct UserResponse: Content {
    let id: UUID
    let email: String
    let name: String
    // No password hash, no internal fields
    init(from user: User) {
        self.id = user.id!
        self.email = user.email
        self.name = user.name
    }
}

func createUser(_ req: Request) async throws -> UserResponse {
    try CreateUserRequest.validate(content: req)
    let dto = try req.content.decode(CreateUserRequest.self)
    let user = User(email: dto.email, name: dto.name,
                    passwordHash: try Bcrypt.hash(dto.password))
    try await user.save(on: req.db)
    return UserResponse(from: user)
}
```

### Eager Loading to Prevent N+1 (Impact: high)

#### Incorrect
```swift
// N+1 query — each user triggers a separate posts query
func listUsers(_ req: Request) async throws -> [UserResponse] {
    let users = try await User.query(on: req.db).all()
    return try await users.asyncMap { user in
        try await user.$posts.load(on: req.db)  // 1 query per user
        return UserResponse(from: user)
    }
}
```

#### Correct
```swift
// Single query with eager loading — 2 queries total regardless of count
func listUsers(_ req: Request) async throws -> Page<UserResponse> {
    let users = try await User.query(on: req.db)
        .with(\.$posts)           // Eager load in single query
        .with(\.$profile)
        .sort(\.$createdAt, .descending)
        .paginate(for: req)       // Built-in pagination

    return users.map { UserResponse(from: $0) }
}
```

### Middleware for Cross-Cutting Concerns (Impact: medium)

#### Incorrect
```swift
// Auth check duplicated in every route handler
func getProfile(_ req: Request) async throws -> UserResponse {
    guard let token = req.headers.bearerAuthorization else { throw Abort(.unauthorized) }
    guard let user = try await Token.verify(token.token, on: req.db) else { throw Abort(.unauthorized) }
    // ... actual logic
}
```

#### Correct
```swift
struct AuthMiddleware: AsyncMiddleware {
    func respond(to request: Request, chainingTo next: AsyncResponder) async throws -> Response {
        guard let bearer = request.headers.bearerAuthorization else {
            throw Abort(.unauthorized, reason: "Missing bearer token")
        }
        guard let token = try await Token.query(on: request.db)
            .filter(\.$value == bearer.token)
            .filter(\.$expiresAt > Date())
            .with(\.$user)
            .first()
        else {
            throw Abort(.unauthorized, reason: "Invalid or expired token")
        }
        request.auth.login(token.user)
        return try await next.respond(to: request)
    }
}

// In routes.swift — applied once, protects all grouped routes
let protected = app.grouped(AuthMiddleware())
protected.get("profile", use: UserController.getProfile)
protected.get("settings", use: UserController.getSettings)
```

## Infrastructure & Deployment

### Dockerfile (multi-stage)
```dockerfile
FROM swift:5.10-jammy AS builder
WORKDIR /app
COPY Package.* ./
RUN swift package resolve
COPY . .
RUN swift build -c release --static-swift-stdlib

FROM ubuntu:22.04
RUN useradd --create-home appuser
WORKDIR /app
COPY --from=builder /app/.build/release/Run .
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s CMD curl -f http://localhost:8080/health || exit 1
ENTRYPOINT ["./Run", "serve", "--hostname", "0.0.0.0", "--port", "8080"]
```

### Linux Deployment
- **Static linking:** `--static-swift-stdlib` eliminates Swift runtime dependency on host.
- **CI parity:** Always test on Linux (GitHub Actions `swift:5.10` container) — Foundation behavior differs from macOS.
- **Memory:** Vapor baseline is ~15MB. Set container limits at 128-256MB for typical APIs.

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| Requests/sec (JSON API) | ~80k | ~150k (release build, connection pooling) |
| Memory baseline | ~15MB | ~10MB (static linking) |
| Cold start | <100ms | <50ms (no JVM/interpreter) |
| Binary size | ~30MB | ~15MB (strip symbols) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| N+1 Fluent queries | Slow list endpoints, DB connection exhaustion | Use `.with(\.$relation)` eager loading |
| Exposing Fluent models as API responses | Leaking internal fields, tight coupling | Separate DTO structs for input/output |
| macOS-only testing | CI passes, Linux prod crashes | Test in Linux Docker container in CI |
| Missing `async` on route handlers | Silent blocking of event loop threads | Use `async throws` on all handlers |
| No connection pool tuning | Connection timeout under load | `app.databases.use(.postgres(config, maxConns: 20))` |
