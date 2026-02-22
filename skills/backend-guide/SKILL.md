---
name: backend-guide
description: |
  Backend development expert skill covering all major languages and frameworks.
  Provides language selection guidance, best practices (Incorrect/Correct patterns),
  infrastructure configuration, and production deployment strategies.

  Written from a senior engineer's perspective with focus on production reliability,
  scalability, and operational excellence.

  Progressive disclosure: this SKILL.md gives overview + selection criteria.
  Detailed guides are in references/ — load only the relevant language file.

  Triggers: backend, server, API, REST, GraphQL, microservice, middleware,
  백엔드, 서버, API, 미들웨어, 마이크로서비스,
  バックエンド, サーバー, API, ミドルウェア,
  后端, 服务器, API, 中间件,
  backend, servidor, API, middleware,
  backend, serveur, API, middleware,
  Backend, Server, API, Middleware,
  backend, server, API, middleware

  Do NOT use for: BaaS platform operations (use baas-expert), frontend-only tasks
  (use frontend-architect), infrastructure-only tasks (use infra-architect),
  static websites (use starter-guide).
agent: bkit:backend-expert
---

# Backend Development Guide

> Build backends that survive 3am incidents. Every pattern here has been battle-tested in production.

## Language Selection Matrix

Pick based on your **actual constraints**, not hype.

| Language | Best For | Avoid When | Ref |
|----------|----------|------------|-----|
| **Node.js (Express/Fastify)** | JS team, real-time, rapid prototyping | CPU-heavy computation | node-express.md |
| **Node.js (NestJS)** | Enterprise Node, large teams, structure-first | Small scripts, quick APIs | node-nestjs.md |
| **Python (FastAPI)** | ML/AI integration, auto-docs, async | Latency-critical paths (<5ms) | python-fastapi.md |
| **Python (Django)** | Admin-heavy apps, rapid CRUD, content sites | Microservices, real-time | python-django.md |
| **Python (Flask)** | Small services, glue APIs, ML serving | Large monoliths | python-flask.md |
| **Go** | High-throughput APIs, CLI tools, infra | Rapid prototyping, ORM-heavy | go-api.md |
| **Rust** | Extreme perf, safety-critical, WASM | Fast iteration, small teams | rust-api.md |
| **Java (Spring Boot)** | Enterprise, existing Java teams, banking | Startups, small projects | java-spring.md |
| **Kotlin (Ktor)** | Modern JVM, coroutines, Android backend | Non-JVM teams | kotlin-ktor.md |
| **C# (ASP.NET Core)** | Azure/Microsoft shops, game backends | Non-Windows teams (though cross-platform now) | csharp-aspnet.md |
| **PHP (Laravel)** | Content-heavy sites, agencies, rapid dev | High-perf APIs, microservices | php-laravel.md |
| **Ruby (Rails)** | Startups, MVPs, convention-first teams | High throughput, type safety | ruby-rails.md |
| **Elixir (Phoenix)** | Real-time, massive concurrency, chat/IoT | Small CRUD, hiring difficulty | elixir-phoenix.md |
| **Scala (Play/Akka)** | Stream processing, big data backends | Simple APIs, small teams | scala-play.md |
| **Swift (Vapor)** | Apple ecosystem server-side | Non-Apple teams | swift-vapor.md |
| **Dart (Serverpod)** | Flutter fullstack, shared types | Non-Flutter projects | dart-serverpod.md |
| **Next.js API Routes** | React fullstack, SSR + API combined | Complex backend logic | nextjs-api.md |
| **Nuxt Server Routes** | Vue fullstack, SSR + API combined | Complex backend logic | nuxt-server.md |
| **SvelteKit** | Svelte fullstack, edge deployment | Complex backend logic | sveltekit-api.md |
| **Bun** | Fast Node alternative, all-in-one toolkit | Production stability needed (maturing) | bun-runtime.md |
| **Deno** | Security-first, TypeScript native, edge | npm ecosystem dependency | deno-runtime.md |

## Decision Framework

```
Q1: Does your team already know a language?
    YES → Use that language. Switching cost > language benefits.
    NO  → Continue.

Q2: Do you need ML/AI integration?
    YES → Python (FastAPI or Django).

Q3: Is latency your #1 constraint (< 10ms p99)?
    YES → Go or Rust.

Q4: Do you need real-time (WebSocket, millions of connections)?
    YES → Elixir (Phoenix) or Go.

Q5: Is rapid development most important?
    YES → Node.js (Express) or Ruby (Rails) or Python (Django).

Q6: Enterprise with existing JVM infrastructure?
    YES → Java (Spring Boot) or Kotlin (Ktor).

Q7: Fullstack with unified codebase?
    YES → Next.js / Nuxt / SvelteKit (match your frontend).

Default → Node.js (Express) + TypeScript. Largest talent pool, fastest hiring.
```

## Common Principles (All Languages)

These apply regardless of language choice:

| Principle | Reference |
|-----------|-----------|
| REST API design, versioning, error format | common-api-design.md |
| Authentication & authorization patterns | common-auth-patterns.md |
| Database access, connection pooling, migrations | common-db-patterns.md |
| Error handling, logging, observability | common-error-handling.md |
| Testing strategy (unit/integration/E2E) | common-testing.md |

## How to Use This Skill

1. Read this SKILL.md to pick your language
2. Load the language-specific reference for best practices + infra guide
3. Load relevant common-* references for cross-cutting concerns
4. Each reference uses **Incorrect/Correct** patterns with quantified impact
