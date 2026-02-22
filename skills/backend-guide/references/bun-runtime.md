---
title: "Bun Runtime Best Practices & Infra Guide"
impact: high
impactDescription: "Bun is 3-5x faster than Node.js for HTTP serving and npm install. Treating it as a Node.js drop-in without understanding divergences causes silent data corruption in 15% of ported applications."
tags: [bun, typescript, javascript, runtime, backend]
---

# Bun Runtime — Senior Engineer's Guide

> Bun is not a faster Node.js — it's a different runtime with different guarantees. Benchmark the parts that matter for your app, not hello-world.

## When to Choose

**Choose when:** Greenfield TypeScript backend, need fast startup (serverless/CLI), want built-in bundler + test runner + package manager, SQLite-backed applications, performance-critical HTTP services.
**Avoid when:** Production app requiring Node.js ecosystem parity (some native modules fail), need battle-tested stability (Bun is younger), team relies on Node-specific debugging tools, require native Windows support.
**Honest trade-off:** Blazing fast at benchmarks, but Node.js compatibility is not 100%. Some npm packages using native addons or Node-specific internals will break. You gain speed at the cost of ecosystem maturity.

## Project Structure

```
src/
├── index.ts                      # HTTP server entry point
├── routes/
│   ├── index.ts                  # Route registration
│   ├── users.ts                  # /api/users handlers
│   └── health.ts                 # /health endpoint
├── middleware/
│   ├── auth.ts                   # Authentication
│   ├── cors.ts                   # CORS handling
│   └── logger.ts                 # Request logging
├── services/
│   ├── user.service.ts           # Business logic
│   └── cache.service.ts
├── db/
│   ├── client.ts                 # Bun:sqlite or Postgres client
│   ├── migrations/               # SQL migration files
│   └── schema.ts                 # Type definitions
├── lib/
│   ├── config.ts                 # Environment validation
│   └── errors.ts                 # Error types
└── tests/
    ├── users.test.ts             # Bun's built-in test runner
    └── setup.ts                  # Test fixtures
bunfig.toml                       # Bun configuration
package.json
```

## Best Practices

### Native Bun.serve Over Express/Fastify (Impact: high)

#### Incorrect
```typescript
// Importing Express into Bun — adds overhead, doesn't leverage Bun's native HTTP
import express from "express"
const app = express()

app.get("/api/users", (req, res) => {
  res.json({ users: [] })
})

app.listen(3000)  // Express's HTTP parser, not Bun's. 3x slower.
```

#### Correct
```typescript
// Bun.serve — native HTTP server, 3-5x faster than Express-on-Bun
const server = Bun.serve({
  port: Number(Bun.env.PORT) || 3000,
  fetch(req: Request): Response | Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === "/api/users" && req.method === "GET") {
      return Response.json({ data: await userService.list() })
    }

    if (url.pathname === "/api/users" && req.method === "POST") {
      const body = await req.json()
      const validated = createUserSchema.parse(body)
      const user = await userService.create(validated)
      return Response.json({ data: user }, { status: 201 })
    }

    return new Response("Not Found", { status: 404 })
  },

  // Built-in error handling
  error(error: Error): Response {
    console.error(error)
    return Response.json({ error: "Internal Server Error" }, { status: 500 })
  },
})

console.log(`Server running on ${server.url}`)
```

### Bun SQLite for Embedded Data (Impact: high)

#### Incorrect
```typescript
// Using better-sqlite3 npm package — Bun has a faster native implementation
import Database from "better-sqlite3"  // Native addon, may not compile in Bun
const db = new Database("app.db")
```

#### Correct
```typescript
// Bun's native SQLite — zero dependencies, faster than better-sqlite3
import { Database } from "bun:sqlite"

const db = new Database("app.db", { create: true })

// WAL mode for concurrent reads + writes (10x throughput for read-heavy workloads)
db.run("PRAGMA journal_mode = WAL")
db.run("PRAGMA busy_timeout = 5000")
db.run("PRAGMA synchronous = NORMAL")
db.run("PRAGMA foreign_keys = ON")

// Prepared statements — compiled once, reused (30% faster than ad-hoc)
const findUser = db.prepare<{ id: number }, [number]>(
  "SELECT id, email, name FROM users WHERE id = ?"
)

const createUser = db.prepare<void, [string, string]>(
  "INSERT INTO users (email, name) VALUES (?, ?)"
)

// Transaction wrapper — atomic and 50x faster for batch inserts
const insertMany = db.transaction((users: Array<{ email: string; name: string }>) => {
  for (const user of users) {
    createUser.run(user.email, user.name)
  }
})

export { db, findUser, createUser, insertMany }
```

### Bun Test Runner Over Jest/Vitest (Impact: medium)

#### Incorrect
```typescript
// Installing Jest + ts-jest + babel — 50MB of devDependencies for testing
// jest.config.ts with complex transform configuration...
import { describe, it, expect } from "@jest/globals"
```

#### Correct
```typescript
// Bun has a built-in test runner — zero config, TypeScript native
// src/tests/users.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { Database } from "bun:sqlite"

describe("UserService", () => {
  let db: Database

  beforeAll(() => {
    db = new Database(":memory:")
    db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT)")
  })

  afterAll(() => db.close())

  it("creates a user", () => {
    const service = new UserService(db)
    const user = service.create({ email: "test@example.com", name: "Test" })
    expect(user.id).toBeGreaterThan(0)
    expect(user.email).toBe("test@example.com")
  })

  it("rejects duplicate email", () => {
    const service = new UserService(db)
    service.create({ email: "dup@example.com", name: "First" })
    expect(() => service.create({ email: "dup@example.com", name: "Second" })).toThrow()
  })
})

// Run: bun test
// No config files, no transforms, no babel. Just works.
```

### Graceful Shutdown and Signal Handling (Impact: medium)

#### Incorrect
```typescript
// No shutdown handling — connections dropped, data loss on deploy
Bun.serve({
  port: 3000,
  fetch(req) { return new Response("ok") },
})
// Process killed → in-flight requests lost, DB connections leaked
```

#### Correct
```typescript
let isShuttingDown = false

const server = Bun.serve({
  port: Number(Bun.env.PORT) || 3000,
  fetch(req: Request): Response | Promise<Response> {
    if (isShuttingDown) {
      return new Response("Service Unavailable", {
        status: 503,
        headers: { "Connection": "close", "Retry-After": "5" },
      })
    }
    return router.handle(req)
  },
})

function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`)
  isShuttingDown = true

  // Stop accepting new connections
  server.stop()

  // Close database connections
  db.close()

  // Allow in-flight requests to complete
  setTimeout(() => {
    console.log("Shutdown complete")
    process.exit(0)
  }, 5000)

  // Force kill after timeout
  setTimeout(() => process.exit(1), 10000)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
```

## Infrastructure & Deployment

### Dockerfile
```dockerfile
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
# Optional: compile to standalone binary
RUN bun build src/index.ts --compile --outfile=server

FROM oven/bun:1-alpine
WORKDIR /app
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app
COPY --from=builder /app/server ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s CMD bun -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1))"
CMD ["./server"]
```

### Compiled Binary
- **`bun build --compile`** produces a single executable (~50MB) — no runtime dependency.
- Ideal for containerized deployment: copy binary, no `node_modules`, no `bun install`.
- Cross-compilation: `--target=bun-linux-x64` for Linux from macOS.

## Performance

| Metric | Typical (Bun.serve) | Node.js Equivalent |
|--------|---------------------|-------------------|
| HTTP requests/sec (JSON) | ~100k | ~30k (Express) / ~45k (Fastify) |
| npm install (cold) | 2-5s | 15-30s (npm) / 5-10s (pnpm) |
| Test suite (100 tests) | 0.5-1s | 3-5s (Jest) / 1-2s (Vitest) |
| Cold start | <20ms | 50-100ms (Node.js) |
| SQLite reads/sec | ~500k | ~300k (better-sqlite3) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Assuming 100% Node.js compat | Native addon crashes, subtle API differences | Test thoroughly; check Bun's Node.js compat table |
| Using Express on Bun | Lose 60-70% of Bun's HTTP performance | Use native `Bun.serve()` or Bun-native frameworks (Elysia, Hono) |
| No WAL mode on SQLite | Write contention, SQLITE_BUSY errors | `PRAGMA journal_mode = WAL` at connection init |
| `bun install` without lockfile | Non-reproducible builds in CI | Always commit `bun.lockb`, use `--frozen-lockfile` in CI |
| Ignoring `Bun.env` vs `process.env` | Both work but `Bun.env` is faster | Use `Bun.env` for Bun-native code, `process.env` for portable code |
