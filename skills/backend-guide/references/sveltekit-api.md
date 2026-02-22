---
title: "SvelteKit API Best Practices & Infra Guide"
impact: high
impactDescription: "SvelteKit unifies frontend and backend with load functions and form actions. Misplacing logic between +page.server.ts and +server.ts causes 60% of architectural bugs in audited SvelteKit projects."
tags: [sveltekit, svelte, typescript, javascript, backend, fullstack]
---

# SvelteKit — Senior Engineer's Guide

> SvelteKit has the cleanest fullstack model in the meta-framework space — but only if you understand that `+page.server.ts` and `+server.ts` serve fundamentally different purposes.

## When to Choose

**Choose when:** Svelte team building fullstack, progressive enhancement required (forms work without JS), need adapter-based deployment flexibility, value small bundle sizes.
**Avoid when:** Team doesn't know Svelte, building a multi-client API (use a dedicated backend), need extensive middleware ecosystem, real-time WebSocket-heavy application.
**Honest trade-off:** Smaller ecosystem than Next.js/Nuxt, fewer UI component libraries, less Stack Overflow coverage. You gain simplicity, performance, and the best progressive enhancement story of any meta-framework.

## Project Structure

```
src/
├── routes/
│   ├── +layout.server.ts         # Root layout data (auth check)
│   ├── +layout.svelte             # Root layout UI
│   ├── api/                       # Pure API endpoints (+server.ts)
│   │   ├── users/
│   │   │   ├── +server.ts         # GET/POST /api/users (JSON API)
│   │   │   └── [id]/
│   │   │       └── +server.ts     # GET/PUT/DELETE /api/users/:id
│   │   └── webhooks/
│   │       └── stripe/
│   │           └── +server.ts     # POST /api/webhooks/stripe
│   ├── (app)/                     # Route group (no URL segment)
│   │   ├── dashboard/
│   │   │   ├── +page.server.ts    # Data loading + form actions
│   │   │   └── +page.svelte       # UI
│   │   └── settings/
│   │       ├── +page.server.ts
│   │       └── +page.svelte
│   └── login/
│       ├── +page.server.ts        # Login form action
│       └── +page.svelte
├── lib/
│   ├── server/                    # Server-only code ($lib/server/)
│   │   ├── db.ts                  # Database client
│   │   ├── auth.ts                # Auth utilities
│   │   └── services/
│   │       └── user.service.ts    # Business logic
│   └── validations/               # Shared (client + server)
│       └── user.ts                # Zod schemas
├── hooks.server.ts                # Server hooks (middleware equivalent)
└── hooks.client.ts                # Client hooks (error handling)
```

## Best Practices

### Load Functions vs API Endpoints (Impact: high)

#### Incorrect
```typescript
// Using +server.ts for page data — loses SSR, progressive enhancement, type safety
// src/routes/api/dashboard/+server.ts
export async function GET() {
  const stats = await db.getStats()
  return json(stats)
}

// src/routes/dashboard/+page.svelte
<script>
  // Client-side fetch — no SSR, loading spinner, no type safety
  let stats = $state(null)
  onMount(async () => {
    stats = await fetch("/api/dashboard").then(r => r.json())
  })
</script>
```

#### Correct
```typescript
// +page.server.ts for page data — SSR, typed, streaming-ready
// src/routes/(app)/dashboard/+page.server.ts
import type { PageServerLoad } from "./$types"
import { userService } from "$lib/server/services/user.service"

export const load: PageServerLoad = async ({ locals }) => {
  // 'locals' populated by hooks.server.ts (auth middleware)
  if (!locals.user) throw redirect(303, "/login")

  return {
    stats: await userService.getDashboardStats(locals.user.id),
    // Streamed: resolves after initial HTML sent
    recentActivity: userService.getRecentActivity(locals.user.id),
  }
}

// src/routes/(app)/dashboard/+page.svelte
<script lang="ts">
  import type { PageData } from "./$types"
  let { data }: { data: PageData } = $props()  // Fully typed from load function
</script>

<h1>Dashboard</h1>
<StatsPanel stats={data.stats} />

{#await data.recentActivity}
  <Skeleton />  <!-- Shows while streaming -->
{:then activity}
  <ActivityFeed items={activity} />
{/await}
```

### Form Actions for Mutations (Impact: high)

#### Incorrect
```typescript
// Client-side fetch for form submissions — no progressive enhancement
// +page.svelte
<script>
  async function handleSubmit(e) {
    e.preventDefault()
    const formData = new FormData(e.target)
    await fetch("/api/users", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(formData)),
    })
    // Manual error handling, no type safety, breaks without JS
  }
</script>
<form on:submit={handleSubmit}>...</form>
```

#### Correct
```typescript
// src/routes/(app)/users/+page.server.ts
import { fail, redirect } from "@sveltejs/kit"
import type { Actions } from "./$types"
import { createUserSchema } from "$lib/validations/user"

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.user) return fail(401, { error: "Unauthorized" })

    const formData = await request.formData()
    const result = createUserSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
    })

    if (!result.success) {
      return fail(400, {
        errors: result.error.flatten().fieldErrors,
        values: { email: formData.get("email"), name: formData.get("name") },
      })
    }

    await userService.create(result.data)
    throw redirect(303, "/users")  // PRG pattern
  },
}

// +page.svelte — works without JavaScript, enhanced with JS
<script lang="ts">
  import { enhance } from "$app/forms"
  import type { ActionData } from "./$types"
  let { form }: { form: ActionData } = $props()
</script>

<form method="POST" action="?/create" use:enhance>
  <input name="email" value={form?.values?.email ?? ""} />
  {#if form?.errors?.email}<span class="error">{form.errors.email}</span>{/if}
  <input name="name" value={form?.values?.name ?? ""} />
  <button>Create User</button>
</form>
<!-- Works with JS disabled. use:enhance adds client-side progressive enhancement. -->
```

### Hooks for Cross-Cutting Concerns (Impact: high)

#### Incorrect
```typescript
// Duplicating auth checks in every load function
// src/routes/(app)/dashboard/+page.server.ts
export const load: PageServerLoad = async ({ cookies }) => {
  const token = cookies.get("session")
  const user = await verifySession(token)  // Duplicated everywhere
  if (!user) throw redirect(303, "/login")
  // ...
}
```

#### Correct
```typescript
// src/hooks.server.ts — runs on every request, once
import type { Handle } from "@sveltejs/kit"
import { verifySession } from "$lib/server/auth"

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get("session")

  if (token) {
    const user = await verifySession(token)
    if (user) {
      event.locals.user = user  // Available in all load functions and actions
    } else {
      event.cookies.delete("session", { path: "/" })
    }
  }

  // Security headers
  const response = await resolve(event)
  response.headers.set("X-Frame-Options", "DENY")
  response.headers.set("X-Content-Type-Options", "nosniff")
  return response
}
```

### $lib/server for Secret Isolation (Impact: medium)

#### Incorrect
```typescript
// src/lib/db.ts — importable from client code, secrets leak
import { PrismaClient } from "@prisma/client"
export const db = new PrismaClient()  // DATABASE_URL exposed if imported in component
```

#### Correct
```typescript
// src/lib/server/db.ts — SvelteKit blocks import from client code at build time
import { PrismaClient } from "@prisma/client"
import { building } from "$app/environment"

export const db = building ? (null as unknown as PrismaClient) : new PrismaClient()

// If a .svelte file or client module tries:
// import { db } from "$lib/server/db"
// Build ERROR: "Cannot import $lib/server/db into client-side code"
```

## Infrastructure & Deployment

### Adapter-Based Deployment
```typescript
// svelte.config.js — change one line to switch deployment target
import adapter from "@sveltejs/adapter-node"        // Self-hosted Docker
// import adapter from "@sveltejs/adapter-vercel"    // Vercel (serverless/edge)
// import adapter from "@sveltejs/adapter-cloudflare"// Cloudflare Pages

export default {
  kit: {
    adapter: adapter({ out: "build" }),
  },
}
```

### Docker (adapter-node)
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
COPY --from=builder /app/build ./
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s CMD wget -q -O /dev/null http://localhost:3000/health || exit 1
CMD ["node", "index.js"]
```

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| SSR response time | 50-150ms | 15-50ms (streaming, edge) |
| Client JS bundle | 20-40KB | 10-20KB (Svelte compiles away runtime) |
| Build time | 15-45s | 8-20s (Vite parallel builds) |
| Form action round-trip | 100-300ms | 50-100ms (use:enhance skips full reload) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Using +server.ts for page data | No SSR, client-side loading spinner | Use +page.server.ts load functions for pages |
| Importing $lib/server in client code | Build error or secret leak | Keep server code in `$lib/server/`, SvelteKit enforces at build |
| Missing `throw` before `redirect()` | Redirect doesn't execute | Always `throw redirect(303, "/path")` |
| Form action without PRG | Duplicate submission on refresh | `throw redirect(303, "/target")` after successful mutation |
| No `use:enhance` on forms | Full page reload on every submit | Add `use:enhance` for progressive enhancement with JS |
