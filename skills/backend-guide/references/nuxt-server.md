---
title: "Nuxt Server Routes Best Practices & Infra Guide"
impact: high
impactDescription: "Nuxt 3 ships a full backend via Nitro engine. Misunderstanding auto-imports and server/client boundaries leaks secrets to the browser in 40%+ of audited Nuxt projects."
tags: [nuxt, vue, typescript, nitro, backend, fullstack]
---

# Nuxt Server Routes — Senior Engineer's Guide

> Nuxt gives you a backend for free — the cost is understanding that `server/` and `app/` are different trust zones.

## When to Choose

**Choose when:** Vue team building fullstack app, need SSR + API in one deployment, rapid prototyping with auto-imports, edge deployment via Nitro.
**Avoid when:** Complex backend that multiple clients consume (build a dedicated API), team unfamiliar with Vue, need WebSocket support beyond basic (Nitro's WS is experimental), CPU-intensive tasks.
**Honest trade-off:** Nitro is powerful but opinionated. Auto-imports reduce boilerplate but make code harder to trace. The magic is great until you need to debug it.

## Project Structure

```
server/
├── api/                          # API routes (/api/*)
│   ├── users/
│   │   ├── index.get.ts          # GET /api/users
│   │   ├── index.post.ts         # POST /api/users
│   │   └── [id].get.ts           # GET /api/users/:id
│   └── auth/
│       ├── login.post.ts
│       └── me.get.ts
├── routes/                       # Non-API routes (no /api prefix)
│   └── health.get.ts             # GET /health
├── middleware/                    # Server middleware (runs on every request)
│   ├── 01.auth.ts                # Numbered for execution order
│   └── 02.logger.ts
├── plugins/                      # Server plugins (startup hooks)
│   └── db.ts
├── utils/                        # Auto-imported server utilities
│   ├── db.ts                     # Database client
│   └── auth.ts                   # Auth helpers
└── services/                     # Business logic (manual import)
    └── user.service.ts
app/
├── pages/
├── components/
└── composables/                  # Client-side composables
nuxt.config.ts
```

## Best Practices

### File-Based Method Routing (Impact: high)

#### Incorrect
```typescript
// server/api/users.ts — handling all methods in one file, manual branching
export default defineEventHandler(async (event) => {
  const method = event.method
  if (method === "GET") {
    return await db.user.findMany()
  } else if (method === "POST") {
    const body = await readBody(event)
    return await db.user.create(body)
  } else if (method === "DELETE") {
    // grows into unmaintainable switch statement
  }
})
```

#### Correct
```typescript
// server/api/users/index.get.ts — GET /api/users
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = Number(query.page) || 1
  return await userService.list({ page, limit: 20 })
})

// server/api/users/index.post.ts — POST /api/users
export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, createUserSchema.parse)
  return await userService.create(body)
})

// server/api/users/[id].get.ts — GET /api/users/:id
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  const user = await userService.findById(id!)
  if (!user) throw createError({ statusCode: 404, message: "User not found" })
  return user
})
// Each file = one method + one route. Clear, testable, no branching.
```

### Input Validation with Typed Schemas (Impact: high)

#### Incorrect
```typescript
// server/api/users.post.ts — trusting client input
export default defineEventHandler(async (event) => {
  const body = await readBody(event)  // No validation — any shape accepted
  const user = await db.user.create({ data: body })  // SQL injection via Prisma? No. But bad data? Yes.
  return user
})
```

#### Correct
```typescript
// server/utils/validations.ts — auto-imported in server/
import { z } from "zod"

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100).trim(),
  role: z.enum(["user", "editor"]).default("user"),
})

// server/api/users.post.ts — validated input
export default defineEventHandler(async (event) => {
  // readValidatedBody throws 400 with Zod errors on invalid input
  const data = await readValidatedBody(event, createUserSchema.parse)
  const user = await userService.create(data)
  setResponseStatus(event, 201)
  return { data: user }
})
```

### Server Middleware vs Route Middleware (Impact: high)

#### Incorrect
```typescript
// Checking auth inside every API handler — duplication, easy to miss one
// server/api/admin/users.get.ts
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  if (!session) throw createError({ statusCode: 401 })
  if (session.role !== "admin") throw createError({ statusCode: 403 })
  // ... actual logic
})
```

#### Correct
```typescript
// server/middleware/01.auth.ts — runs on ALL server requests, numbered for order
export default defineEventHandler(async (event) => {
  // Skip public routes
  const publicPaths = ["/api/auth/login", "/api/health", "/health"]
  if (publicPaths.some(p => event.path.startsWith(p))) return

  const session = await getUserSession(event)
  if (!session && event.path.startsWith("/api/")) {
    throw createError({ statusCode: 401, message: "Authentication required" })
  }

  // Attach user to event context — available in all handlers
  event.context.user = session
})

// server/api/admin/users.get.ts — auth already handled
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (user.role !== "admin") {
    throw createError({ statusCode: 403, message: "Admin access required" })
  }
  return await userService.listAll()
})
```

### Separating Server Utils from Client Composables (Impact: medium)

#### Incorrect
```typescript
// composables/useAuth.ts — accidentally importing server code
import { db } from "~/server/utils/db"  // DANGER: DB client bundled to browser

export const useAuth = () => {
  const login = async (email: string, password: string) => {
    const user = await db.user.findFirst({ where: { email } })  // DB query in browser!
  }
}
```

#### Correct
```typescript
// server/utils/auth.ts — server only, auto-imported in server/ directory
export async function verifyCredentials(email: string, password: string) {
  const user = await db.user.findFirst({ where: { email } })
  if (!user || !await verify(password, user.passwordHash)) return null
  return { id: user.id, email: user.email, role: user.role }
}

// composables/useAuth.ts — client only, calls API
export const useAuth = () => {
  const login = async (email: string, password: string) => {
    const { data, error } = await useFetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
    })
    if (error.value) throw new Error(error.value.message)
    return data.value
  }
  return { login }
}
// server/utils/ = server trust zone. composables/ = client trust zone. Never cross.
```

## Infrastructure & Deployment

### Nitro Presets (deploy anywhere)
```typescript
// nuxt.config.ts — target-specific builds
export default defineNuxtConfig({
  nitro: {
    preset: "vercel-edge",  // or: "node-server", "cloudflare-pages", "deno-deploy", "bun"
  },
})
```

### Docker (self-hosted with node-server preset)
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app
COPY --from=builder /app/.output ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s CMD wget -q -O /dev/null http://localhost:3000/health || exit 1
CMD ["node", "server/index.mjs"]
```

### Edge Deployment
- **Vercel/Cloudflare:** Nitro compiles to edge-compatible bundles automatically.
- **Limitation:** No Node.js-specific APIs (fs, child_process) on edge. Use `process.server` guards.
- **Database:** Use HTTP-based databases (Turso, PlanetScale, Neon serverless driver) on edge.

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| API route cold start (serverless) | 150-400ms | 30-80ms (edge preset) |
| SSR response time | 80-200ms | 20-60ms (component caching, ISR) |
| Build time | 30-90s | 15-40s (parallel route building) |
| Nitro output size | 2-5MB | 1-2MB (tree-shaking, minification) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Importing server utils in client code | Secrets/DB in browser bundle | Keep `server/utils/` and `composables/` strictly separated |
| Auto-import name collisions | Wrong function called silently | Use explicit imports for ambiguous names, check `.nuxt/types` |
| Missing `.get.ts`/`.post.ts` suffix | Route handles all methods unexpectedly | Always use method suffix: `index.get.ts`, `index.post.ts` |
| No error handling in `useFetch` | Unhandled rejections in components | Always check `error.value` from `useFetch`/`useAsyncData` |
| Server middleware running on static assets | Performance degradation | Filter by `event.path` prefix in middleware |
