---
title: "Deno Runtime Best Practices & Infra Guide"
impact: high
impactDescription: "Deno is secure-by-default with native TypeScript. Ignoring the permissions model negates its primary advantage, and misusing npm compat adds 30-50% overhead vs native Deno modules."
tags: [deno, typescript, javascript, runtime, backend]
---

# Deno Runtime — Senior Engineer's Guide

> Deno fixes Node.js's original sins — but only if you actually use the permissions model instead of running everything with `--allow-all`.

## When to Choose

**Choose when:** Security-sensitive applications (permissions model), TypeScript-first without build step, edge deployment (Deno Deploy), want standard Web APIs (fetch, Request/Response), new project without Node.js baggage.
**Avoid when:** Heavy reliance on Node.js native addons, team deeply invested in Node.js tooling, need maximum npm ecosystem compatibility (improving but not 100%), Windows-first deployment.
**Honest trade-off:** Stronger security model and better developer experience than Node.js, but smaller ecosystem of native Deno modules. npm compat bridge works for most packages but adds overhead and complexity.

## Project Structure

```
src/
├── main.ts                       # Entry point with permissions
├── routes/
│   ├── mod.ts                    # Route registration (Oak/Hono)
│   ├── users.ts                  # /api/users handlers
│   └── health.ts                 # /health endpoint
├── middleware/
│   ├── auth.ts                   # Authentication
│   ├── cors.ts                   # CORS
│   └── logger.ts                 # Request logging
├── services/
│   ├── user.service.ts           # Business logic
│   └── cache.service.ts
├── db/
│   ├── client.ts                 # Database client (Deno.Kv or Postgres)
│   └── schema.ts
├── lib/
│   ├── config.ts                 # Environment validation
│   └── errors.ts                 # Error types
└── tests/
    ├── users_test.ts             # Deno.test (built-in)
    └── test_utils.ts
deno.json                         # Import map + tasks + permissions
```

## Best Practices

### Principle of Least Permission (Impact: high)

#### Incorrect
```bash
# Running with all permissions — defeats Deno's entire security model
deno run --allow-all src/main.ts

# Or in deno.json:
{
  "tasks": {
    "start": "deno run --allow-all src/main.ts"
  }
}
# This is "Node.js mode" — you've thrown away Deno's primary advantage.
```

#### Correct
```json
// deno.json — explicit, minimal permissions
{
  "tasks": {
    "start": "deno run --allow-net=0.0.0.0:8000 --allow-env=DATABASE_URL,PORT,JWT_SECRET --allow-read=./static,./config src/main.ts",
    "dev": "deno run --watch --allow-net --allow-env --allow-read src/main.ts",
    "test": "deno test --allow-net=localhost --allow-env --allow-read"
  }
}
```

```typescript
// Production startup script with granular permissions
// scripts/start.sh
#!/bin/sh
exec deno run \
  --allow-net=0.0.0.0:${PORT:-8000} \
  --allow-net=db.example.com:5432 \
  --allow-env=DATABASE_URL,PORT,JWT_SECRET,NODE_ENV \
  --allow-read=/app/static,/app/config \
  --deny-write \
  --deny-run \
  src/main.ts
# If code tries to read /etc/passwd or connect to an unexpected host → Permission denied
```

### Native Deno APIs Over npm Packages (Impact: high)

#### Incorrect
```typescript
// Importing node:fs and express via npm compat — adds overhead, loses Deno advantages
import express from "npm:express"
import fs from "node:fs"

const app = express()
app.get("/data", (req, res) => {
  const data = fs.readFileSync("./data.json", "utf-8")  // Sync, blocking
  res.json(JSON.parse(data))
})
app.listen(3000)
// npm: prefix adds ~30% overhead vs native Deno modules
```

#### Correct
```typescript
// Native Deno APIs — Web standard, no npm overhead
import { Hono } from "jsr:@hono/hono"  // JSR registry, native Deno module

const app = new Hono()

app.get("/data", async (c) => {
  const data = await Deno.readTextFile("./data.json")  // Async, non-blocking
  return c.json(JSON.parse(data))
})

// Deno.serve — native HTTP server, Web standard Request/Response
Deno.serve({ port: Number(Deno.env.get("PORT")) || 8000 }, app.fetch)
```

### Deno KV for Serverless State (Impact: high)

#### Incorrect
```typescript
// Using in-memory Map for state — lost on restart, doesn't work multi-instance
const sessions = new Map<string, Session>()

function getSession(token: string): Session | undefined {
  return sessions.get(token)  // Gone after deploy, not shared across instances
}
```

#### Correct
```typescript
// Deno KV — built-in key-value store, persistent, works on Deno Deploy
const kv = await Deno.openKv()  // Local SQLite in dev, distributed on Deno Deploy

async function createSession(userId: string): Promise<string> {
  const token = crypto.randomUUID()
  const session = { userId, createdAt: Date.now() }

  await kv.set(["sessions", token], session, {
    expireIn: 24 * 60 * 60 * 1000,  // Auto-expire after 24h
  })
  return token
}

async function getSession(token: string): Promise<Session | null> {
  const result = await kv.get<Session>(["sessions", token])
  return result.value
}

// Atomic operations for consistency
async function transferCredits(from: string, to: string, amount: number) {
  let success = false
  while (!success) {
    const fromEntry = await kv.get<number>(["credits", from])
    const toEntry = await kv.get<number>(["credits", to])

    if ((fromEntry.value ?? 0) < amount) throw new Error("Insufficient credits")

    const result = await kv.atomic()
      .check(fromEntry)  // Optimistic concurrency — retry if changed
      .check(toEntry)
      .set(["credits", from], (fromEntry.value ?? 0) - amount)
      .set(["credits", to], (toEntry.value ?? 0) + amount)
      .commit()

    success = result.ok
  }
}
```

### Structured Testing with Deno.test (Impact: medium)

#### Incorrect
```typescript
// No test organization, no cleanup, no permission scoping
Deno.test("user stuff", async () => {
  // One giant test that does everything
  const user = await createUser({ email: "test@test.com" })
  assertEquals(user.email, "test@test.com")
  const fetched = await getUser(user.id)
  assertEquals(fetched?.name, user.name)
  await deleteUser(user.id)
  // If any assertion fails, rest don't run, DB is dirty
})
```

#### Correct
```typescript
// Structured test suites with setup/teardown and step isolation
import { assertEquals, assertRejects } from "jsr:@std/assert"

Deno.test("UserService", async (t) => {
  const kv = await Deno.openKv(":memory:")  // In-memory for tests
  const service = new UserService(kv)

  await t.step("creates a user with valid data", async () => {
    const user = await service.create({ email: "test@test.com", name: "Test" })
    assertEquals(user.email, "test@test.com")
    assertEquals(typeof user.id, "string")
  })

  await t.step("rejects duplicate email", async () => {
    await service.create({ email: "dup@test.com", name: "First" })
    await assertRejects(
      () => service.create({ email: "dup@test.com", name: "Second" }),
      Error,
      "Email already exists",
    )
  })

  await t.step("returns null for nonexistent user", async () => {
    const user = await service.findById("nonexistent")
    assertEquals(user, null)
  })

  kv.close()
})

// Run with minimal permissions: deno test --allow-read --allow-env
```

## Infrastructure & Deployment

### Deno Deploy (edge, recommended)
```typescript
// No Docker needed — deploy directly from GitHub
// deno.json
{
  "tasks": {
    "start": "deno run --allow-net --allow-env --allow-read src/main.ts"
  },
  "deploy": {
    "project": "my-api",
    "entrypoint": "src/main.ts"
  }
}
```
- **Zero cold start:** Deno Deploy uses V8 isolates, not containers. Starts in <10ms.
- **Global edge:** Deployed to 35+ regions automatically.
- **Deno KV:** Distributed, consistent storage included at no extra config.

### Docker (self-hosted)
```dockerfile
FROM denoland/deno:2.1 AS builder
WORKDIR /app
COPY deno.json deno.lock ./
RUN deno install
COPY . .
RUN deno check src/main.ts

FROM denoland/deno:2.1
WORKDIR /app
RUN addgroup -g 1001 app && adduser -u 1001 -G app -S app
COPY --from=builder /app ./
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s CMD deno run --allow-net=localhost:8000 -e "const r = await fetch('http://localhost:8000/health'); Deno.exit(r.ok ? 0 : 1)"
CMD ["deno", "run", "--allow-net=0.0.0.0:8000", "--allow-env", "--allow-read=./static", "src/main.ts"]
```

### Compile to Binary
```bash
# Single executable — no Deno runtime needed on target
deno compile --allow-net --allow-env --allow-read=./static --output=server src/main.ts
# ~70MB binary, runs anywhere without Deno installed
```

## Performance

| Metric | Typical (Deno.serve) | Node.js Equivalent |
|--------|---------------------|-------------------|
| HTTP requests/sec (JSON) | ~80k | ~30k (Express) / ~45k (Fastify) |
| Cold start (Deno Deploy) | <10ms | 200-500ms (Lambda/Vercel) |
| TypeScript execution | Native (no build) | Requires tsc/esbuild/swc step |
| Memory baseline | ~20MB | ~50MB (Node.js) |
| Deno KV read latency | <1ms local, <10ms edge | Requires external Redis/DynamoDB |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| `--allow-all` in production | No security benefit from Deno | Specify exact permissions per resource |
| Heavy npm: imports | 30-50% slower than native modules | Prefer `jsr:` registry and Deno-native modules |
| Ignoring `deno.lock` | Non-reproducible builds | Commit lockfile, use `--frozen` in CI |
| Deno KV without atomic ops | Race conditions on concurrent writes | Use `kv.atomic().check()` for optimistic concurrency |
| No `deno check` in CI | Type errors caught at runtime | Add `deno check src/main.ts` to CI pipeline |
