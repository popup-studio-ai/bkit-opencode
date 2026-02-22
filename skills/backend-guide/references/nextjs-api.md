---
title: "Next.js API Routes Best Practices & Infra Guide"
impact: high
impactDescription: "Next.js powers 30%+ of React production apps. Misusing Server Actions as a general API and ignoring cold starts causes 5-10x latency spikes on serverless edge."
tags: [nextjs, react, typescript, javascript, backend, fullstack]
---

# Next.js API Routes — Senior Engineer's Guide

> Next.js is a frontend framework with backend escape hatches — know where the boundary is or you'll build a monolith that scales like neither.

## When to Choose

**Choose when:** React frontend with lightweight API needs, BFF (Backend-for-Frontend) pattern, server-side rendering with data fetching, rapid fullstack prototyping.
**Avoid when:** Complex backend logic (use a dedicated API), CPU-intensive processing, multi-client API (mobile + web + third-party), need WebSockets or long-running connections on serverless.
**Honest trade-off:** You get speed-to-market but sacrifice backend flexibility. API routes are serverless functions with cold start penalties and execution time limits. This is a frontend framework — not a backend framework with a React renderer.

## Project Structure

```
app/
├── layout.tsx                    # Root layout (server component)
├── page.tsx                      # Home page
├── api/                          # API Route Handlers
│   ├── users/
│   │   ├── route.ts              # GET /api/users, POST /api/users
│   │   └── [id]/
│   │       └── route.ts          # GET/PUT/DELETE /api/users/:id
│   └── webhooks/
│       └── stripe/
│           └── route.ts          # POST /api/webhooks/stripe
├── (dashboard)/                  # Route group (no URL impact)
│   ├── layout.tsx
│   └── settings/
│       ├── page.tsx              # Server Component with data fetching
│       └── actions.ts            # Server Actions for mutations
├── middleware.ts                  # Edge middleware (auth, redirects)
lib/
├── db.ts                         # Database client (Prisma/Drizzle)
├── auth.ts                       # Auth helpers (NextAuth)
├── validations/
│   └── user.ts                   # Zod schemas (shared client/server)
└── services/
    └── user.service.ts           # Business logic (framework-agnostic)
```

## Best Practices

### Route Handlers Over Pages API Routes (Impact: high)

#### Incorrect
```typescript
// pages/api/users.ts — old Pages Router API (still works but legacy)
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const users = await db.user.findMany()
    res.status(200).json(users)
  } else if (req.method === "POST") {
    // Manual method routing, no Web API standards
    const body = req.body
    res.status(201).json(user)
  }
}
```

#### Correct
```typescript
// app/api/users/route.ts — App Router Route Handlers (Web standard Request/Response)
import { NextRequest, NextResponse } from "next/server"
import { createUserSchema } from "@/lib/validations/user"
import { userService } from "@/lib/services/user.service"

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const page = Number(searchParams.get("page")) || 1

  const users = await userService.list({ page, limit: 20 })
  return NextResponse.json({ data: users })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const validated = createUserSchema.parse(body)  // Zod validation

  const user = await userService.create(validated)
  return NextResponse.json({ data: user }, { status: 201 })
}

// Each HTTP method is a named export — no manual routing
// Uses Web standard Request/Response — portable, testable
```

### Server Actions for Mutations Only (Impact: high)

#### Incorrect
```typescript
// Using Server Actions for data fetching — anti-pattern
"use server"
export async function getUsers() {
  // Server Actions are POST requests — don't use for reads
  // No caching, no ISR, no revalidation, breaks back/forward
  return await db.user.findMany()
}

// In component:
const users = await getUsers()  // Makes a POST on every render
```

#### Correct
```typescript
// Data fetching: Server Components with fetch (cacheable, revalidatable)
// app/(dashboard)/users/page.tsx
async function UsersPage() {
  const users = await userService.list({ page: 1, limit: 20 })
  // Runs at build time or on-demand — cached by default
  return <UserList users={users} />
}

// Mutations: Server Actions (form submissions, state changes)
// app/(dashboard)/users/actions.ts
"use server"
import { revalidatePath } from "next/cache"

export async function createUser(formData: FormData) {
  const validated = createUserSchema.parse({
    email: formData.get("email"),
    name: formData.get("name"),
  })

  await userService.create(validated)
  revalidatePath("/users")  // Invalidate cached data
}

// Client component uses the action
<form action={createUser}>
  <input name="email" type="email" required />
  <button type="submit">Create</button>
</form>
```

### Middleware for Auth and Redirects (Impact: high)

#### Incorrect
```typescript
// Checking auth in every route handler — duplication, easy to forget
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // ... actual logic
}
```

#### Correct
```typescript
// middleware.ts — runs on edge, before any route handler
import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "@/lib/auth"

const publicPaths = ["/", "/login", "/api/webhooks"]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Skip public paths
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = request.cookies.get("session-token")?.value
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return NextResponse.redirect(new URL("/login", request.url))
  }

  const user = await verifyToken(token)
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // Pass user info downstream via headers
  const response = NextResponse.next()
  response.headers.set("x-user-id", user.id)
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
```

### Separating Business Logic from Framework (Impact: medium)

#### Incorrect
```typescript
// Business logic coupled to Next.js — can't test, can't reuse
export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = await prisma.user.create({ data: body })
  await prisma.auditLog.create({ data: { action: "created", userId: user.id } })
  // Send email inline...
  await fetch("https://api.sendgrid.com/...", { ... })
  return NextResponse.json(user)
}
```

#### Correct
```typescript
// lib/services/user.service.ts — zero framework imports, pure business logic
export class UserService {
  constructor(private db: PrismaClient, private mailer: MailService) {}

  async create(data: CreateUserInput): Promise<User> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({ data })
      await tx.auditLog.create({
        data: { action: "user_created", entityId: user.id },
      })
      await this.mailer.sendWelcome(user.email)
      return user
    })
  }
}

// Route handler is thin — just HTTP translation
export async function POST(request: NextRequest) {
  const body = await request.json()
  const validated = createUserSchema.parse(body)
  const user = await userService.create(validated)
  return NextResponse.json({ data: user }, { status: 201 })
}
```

## Infrastructure & Deployment

### Vercel (default, optimized)
```json
// vercel.json — minimal config needed
{
  "functions": {
    "app/api/heavy/**": {
      "maxDuration": 30,
      "memory": 1024
    }
  }
}
```
- **Edge Runtime:** Add `export const runtime = "edge"` for low-latency, globally distributed routes (limited Node.js APIs).
- **ISR:** `export const revalidate = 60` for time-based cache invalidation.

### Docker (self-hosted)
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
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```
- **Requires:** `output: "standalone"` in `next.config.js` for Docker builds.

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| API route cold start (serverless) | 200-500ms | 50-100ms (edge runtime) |
| SSR response time | 100-300ms | 30-80ms (streaming + Suspense) |
| Build time (500 pages) | 3-5min | 1-2min (parallel routes, turbopack) |
| Bundle size overhead | 85KB base | 70KB (tree-shaking, dynamic imports) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Server Actions for reads | No caching, POST requests for GET data | Use Server Components + fetch for reads |
| DB connections in serverless | Pool exhaustion, connection refused | Use connection pooler (PgBouncer, Prisma Accelerate) |
| Missing `"use server"` directive | Secrets leaked to client bundle | Always add directive, audit with `next build` |
| No `revalidatePath` after mutations | Stale data shown to users | Call `revalidatePath()` or `revalidateTag()` after writes |
| Edge runtime with Node.js APIs | Runtime error (fs, crypto.subtle differs) | Check edge compatibility or use Node.js runtime |
