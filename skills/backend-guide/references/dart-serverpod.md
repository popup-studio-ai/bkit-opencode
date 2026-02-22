---
title: "Dart Serverpod Best Practices & Infra Guide"
impact: medium
impactDescription: "Serverpod enables Flutter fullstack with shared types. Skipping code generation and misusing shared models causes type drift that breaks clients silently at runtime."
tags: [dart, serverpod, flutter, fullstack, backend]
---

# Dart Serverpod — Senior Engineer's Guide

> One language, one type system, zero serialization bugs — that's the Serverpod promise if you respect the code generation boundary.

## When to Choose

**Choose when:** Flutter app team wanting fullstack Dart, need shared types between client/server, real-time features (WebSocket/streaming), startup velocity with type-safe API.
**Avoid when:** No Flutter frontend (use Go/Node instead), need battle-tested ecosystem maturity, large-scale microservices (ecosystem still young), team unfamiliar with Dart.
**Honest trade-off:** Younger ecosystem than Express/Django, smaller community, ORM less flexible than Prisma/SQLAlchemy. You gain type safety across the entire stack at the cost of ecosystem breadth.

## Project Structure

```
my_project/
├── my_project_server/            # Server package
│   ├── lib/
│   │   └── src/
│   │       ├── endpoints/        # API endpoints (code-generated protocol)
│   │       │   ├── user_endpoint.dart
│   │       │   └── auth_endpoint.dart
│   │       ├── models/           # Server-side models (not shared)
│   │       ├── services/         # Business logic
│   │       │   └── user_service.dart
│   │       └── generated/        # Auto-generated — DO NOT EDIT
│   │           ├── endpoints.dart
│   │           └── protocol.dart
│   ├── config/
│   │   ├── development.yaml
│   │   ├── staging.yaml
│   │   └── production.yaml
│   └── migrations/               # Database migrations
├── my_project_client/            # Generated client package
│   └── lib/
│       └── src/
│           └── protocol/         # Shared types — auto-generated
├── my_project_flutter/           # Flutter app
│   └── lib/
│       └── src/
│           └── screens/
└── my_project_shared/            # Shared protocol definitions
    └── lib/
        └── src/
            └── protocol/
                └── user.yaml     # Model definitions (source of truth)
```

## Best Practices

### Protocol-First Model Design (Impact: high)

#### Incorrect
```dart
// Hand-writing model classes and duplicating across client/server
// server/lib/src/models/user.dart
class User {
  final int? id;
  final String email;
  final String name;

  User({this.id, required this.email, required this.name});

  Map<String, dynamic> toJson() => {'id': id, 'email': email, 'name': name};
}

// client/lib/src/models/user.dart — manually kept "in sync"
class User {
  final int? id;
  final String email;
  // Forgot to add 'name' field — client silently breaks
}
```

#### Correct
```yaml
# my_project_shared/lib/src/protocol/user.yaml — Single source of truth
class: User
table: users
fields:
  email: String
  name: String
  role: String, default="'user'"
  createdAt: DateTime
indexes:
  user_email_idx:
    fields: email
    unique: true
```

```bash
# Generates server model, client model, migration, and serialization — in sync by construction
serverpod generate
```

```dart
// Now both server and client share the exact same User type
// Server endpoint:
class UserEndpoint extends Endpoint {
  Future<User> getUser(Session session, int id) async {
    final user = await User.db.findById(session, id);
    if (user == null) throw EndpointException('User not found');
    return user;  // Serialization is auto-generated, type-safe
  }
}

// Flutter client — same User type, zero manual parsing
final user = await client.user.getUser(42);
print(user.name);  // Dart type system guarantees this field exists
```

### Session-Scoped Database Operations (Impact: high)

#### Incorrect
```dart
// Creating ad-hoc database connections — no transaction support, connection leak risk
class UserEndpoint extends Endpoint {
  Future<User> createUser(Session session, CreateUserRequest req) async {
    final db = DatabaseConnection(config);  // Bypasses session pool
    await db.insert(User(email: req.email, name: req.name));
    await db.insert(AuditLog(action: 'user_created'));  // No transaction!
    // If audit insert fails, user exists without audit trail
  }
}
```

#### Correct
```dart
class UserEndpoint extends Endpoint {
  Future<User> createUser(Session session, CreateUserRequest req) async {
    return session.db.transaction((transaction) async {
      final user = User(
        email: req.email,
        name: req.name,
        createdAt: DateTime.now().toUtc(),
      );
      final inserted = await User.db.insertRow(session, user, transaction: transaction);

      await AuditLog.db.insertRow(session, AuditLog(
        action: 'user_created',
        entityId: inserted.id!,
      ), transaction: transaction);

      return inserted;  // Both succeed or both roll back
    });
  }
}
```

### Endpoint Authentication and Authorization (Impact: high)

#### Incorrect
```dart
// No auth — every endpoint is public by default
class AdminEndpoint extends Endpoint {
  Future<List<User>> listAllUsers(Session session) async {
    return await User.db.find(session);  // Anyone can call this
  }
}
```

#### Correct
```dart
class AdminEndpoint extends Endpoint {
  // Require authentication at the endpoint level
  @override
  bool get requireLogin => true;

  Future<List<User>> listAllUsers(Session session) async {
    // Check authorization after authentication
    final authUser = await session.authenticated;
    if (authUser == null) throw AuthenticationException();

    final userInfo = await User.db.findById(session, authUser.userId);
    if (userInfo?.role != 'admin') {
      throw EndpointException('Forbidden: admin access required');
    }

    return await User.db.find(
      session,
      where: (t) => t.role.notEquals('superadmin'),  // Never expose superadmins
      limit: 100,
      orderBy: (t) => t.createdAt,
      orderDescending: true,
    );
  }
}
```

### Streaming for Real-Time Features (Impact: medium)

#### Incorrect
```dart
// Polling from Flutter client — wasteful, laggy, battery-draining
// Flutter side:
Timer.periodic(Duration(seconds: 2), (_) async {
  final messages = await client.chat.getNewMessages(lastId);
  setState(() => _messages.addAll(messages));
});
```

#### Correct
```dart
// Server: stream endpoint with Serverpod's built-in streaming
class ChatEndpoint extends Endpoint {
  @override
  Future<void> streamOpened(StreamingSession session) async {
    final userId = await session.authenticated?.userId;
    if (userId == null) { session.close(); return; }
    // Register session for this user's channels
    setUserObject(session, UserConnection(userId: userId));
  }

  @override
  Future<void> handleStreamMessage(
    StreamingSession session,
    SerializableModel message,
  ) async {
    if (message is ChatMessage) {
      // Validate and broadcast to room participants
      final sanitized = message.copyWith(
        body: sanitizeHtml(message.body),
        timestamp: DateTime.now().toUtc(),
      );
      await ChatMessage.db.insertRow(session, sanitized);
      sendStreamMessage(session, sanitized);  // Real-time push
    }
  }
}

// Flutter client — reactive stream, no polling
final stream = client.chat.stream;
stream.listen((message) {
  setState(() => _messages.add(message as ChatMessage));
});
```

## Infrastructure & Deployment

### Docker Compose (development)
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: my_project
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  server:
    build: ./my_project_server
    depends_on: [postgres, redis]
    environment:
      SERVERPOD_DATABASE_HOST: postgres
      SERVERPOD_REDIS_HOST: redis
    ports:
      - "8080:8080"
      - "8081:8081"  # Insights API
```

### Production Deployment
- **Always run `serverpod generate`** in CI before build — ensures protocol is up to date.
- **Migrations:** Run `serverpod create-migration` for schema changes. Never edit generated migration files.
- **Config per environment:** Use `production.yaml` with environment variable interpolation for secrets.

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| Requests/sec (JSON API) | ~20k | ~40k (connection pooling, release mode) |
| WebSocket connections | 10k/node | 50k/node (tune isolate count) |
| Memory baseline | ~40MB | ~25MB (release build, trimmed) |
| Code generation time | 2-5s | Incremental on file watch |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Editing generated files | Changes overwritten on next `generate` | Only edit `.yaml` protocol files, re-generate |
| Skipping `serverpod generate` in CI | Client/server type mismatch at runtime | Add `serverpod generate --check` to CI pipeline |
| No transaction on multi-table writes | Partial data on failures | Use `session.db.transaction()` for atomic ops |
| Exposing internal fields in protocol | Client sees password hashes, internal IDs | Separate public/private models in protocol YAML |
| Missing `requireLogin` on endpoints | All endpoints public by default | Set `requireLogin => true` and check roles explicitly |
