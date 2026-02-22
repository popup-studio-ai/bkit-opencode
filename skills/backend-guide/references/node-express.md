---
title: "Node.js Express/Fastify Best Practices & Infra Guide"
impact: high
impactDescription: "Express is the most deployed backend framework. Default patterns lead to memory leaks and unhandled rejections at scale."
tags: [node, express, fastify, javascript, typescript, backend]
---

# Node.js (Express/Fastify) — Senior Engineer's Guide

> Express got you started. Production discipline keeps you running.

## When to Choose

**Choose when:** JS/TS team, real-time features, JSON API, rapid prototyping, shared code with frontend.
**Avoid when:** CPU-intensive computation (image processing, ML), need strict concurrency guarantees.
**Honest trade-off:** Single-threaded event loop means one blocked operation stalls everything.

**Express vs Fastify:** Fastify is 2-3x faster, has built-in schema validation, better DX. Use Fastify for new projects. Express only if team knows it well or existing codebase.

## Project Structure

```
src/
├── server.ts              # HTTP server bootstrap (separate from app)
├── app.ts                 # Express/Fastify app configuration
├── routes/
│   ├── index.ts           # Route registration
│   ├── users.ts           # /v1/users routes
│   └── posts.ts           # /v1/posts routes
├── middleware/
│   ├── auth.ts            # Authentication middleware
│   ├── error-handler.ts   # Centralized error handler
│   ├── rate-limit.ts      # Rate limiting
│   └── validate.ts        # Request validation
├── services/
│   ├── user.service.ts    # Business logic (no HTTP concepts)
│   └── post.service.ts
├── repositories/
│   ├── user.repo.ts       # Database access
│   └── post.repo.ts
├── lib/
│   ├── db.ts              # Database pool
│   ├── logger.ts          # Pino logger setup
│   └── config.ts          # Environment config with validation
└── types/
    └── index.ts           # Shared types
```

## Best Practices

### Separate App from Server (Impact: high)

#### Incorrect
```typescript
const app = express()
app.get("/", (req, res) => res.json({ ok: true }))
app.listen(3000)  // Can't test without starting server
```

#### Correct
```typescript
// app.ts — testable without listening
export const app = express()
app.use(express.json({ limit: "1mb" }))
app.use(routes)
app.use(errorHandler)

// server.ts — startup only
import { app } from "./app"
const server = app.listen(Number(process.env.PORT) || 3000, () => {
  logger.info({ port: 3000 }, "Server started")
})

// Graceful shutdown
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    logger.info({ signal }, "Shutting down")
    server.close(() => {
      pool.end()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10000)  // force kill after 10s
  })
}
```

### Async Error Handling (Impact: high)

#### Incorrect
```typescript
// Express does NOT catch async errors by default!
app.get("/users/:id", async (req, res) => {
  const user = await userService.findById(req.params.id)  // throws → unhandled rejection → crash
  res.json(user)
})
```

#### Correct
```typescript
// Wrapper that catches async errors and forwards to error handler
const asyncHandler = (fn: RequestHandler): RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

app.get("/users/:id", asyncHandler(async (req, res) => {
  const user = await userService.findById(req.params.id)
  if (!user) throw new AppError("User not found", "USER_NOT_FOUND", 404)
  res.json({ data: user })
}))

// Or use express 5.x / Fastify (both handle async natively)
```

### Input Validation (Impact: high)

#### Incorrect
```typescript
app.post("/users", async (req, res) => {
  const { email, name } = req.body  // No validation = injection + bad data
  await db.query("INSERT INTO users (email, name) VALUES ($1, $2)", [email, name])
})
```

#### Correct
```typescript
// Zod schema (works with both Express and Fastify)
const createUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100).trim(),
  role: z.enum(["user", "admin"]).default("user"),
})

app.post("/users", asyncHandler(async (req, res) => {
  const data = createUserSchema.parse(req.body)  // throws ZodError on invalid
  const user = await userService.create(data)
  res.status(201).json({ data: user })
}))
```

### Environment Config (Impact: medium)

#### Incorrect
```typescript
const dbHost = process.env.DB_HOST || "localhost"  // silent fallback to wrong value
```

#### Correct
```typescript
// Validate all env vars at startup — fail fast
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
})

export const config = envSchema.parse(process.env)
// Crashes immediately on startup if config is invalid — not at 3am when the var is first used
```

## Infrastructure & Deployment

### Dockerfile (multi-stage)
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && cp -R node_modules /prod_modules
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app
COPY --from=builder /prod_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json .
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s CMD wget -q -O /dev/null http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

### Scaling
- **Horizontal:** Stateless app behind load balancer. Sessions in Redis, not memory.
- **Cluster mode:** `pm2 start app.js -i max` or let K8s manage replicas (preferred).
- **Memory limit:** Set `--max-old-space-size=512` (match container memory - 128MB headroom).

## Performance

| Metric | Express | Fastify |
|--------|---------|---------|
| Requests/sec (hello world) | ~15k | ~45k |
| JSON serialization | Manual | Built-in fast-json-stringify |
| Memory baseline | ~50MB | ~40MB |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| No async error wrapper | Unhandled rejection crash | asyncHandler or Express 5 |
| `express.json()` no limit | OOM on large payloads | `{ limit: "1mb" }` |
| No graceful shutdown | Dropped requests on deploy | SIGTERM handler + drain |
| Event loop blocking | All requests stall | Move CPU work to worker_threads |
| Memory leaks in closures | Memory grows until OOM | Profile with `--inspect`, fix event listener leaks |
| `console.log` in prod | Blocks event loop, no structure | Use pino (async, JSON) |
