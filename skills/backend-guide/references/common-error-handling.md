---
title: "Error Handling, Logging & Observability"
impact: high
impactDescription: "Poor error handling turns a 5-minute fix into a 2-hour incident. Structured logging cuts MTTR by 60%."
tags: [common, error, logging, observability, monitoring]
---

# Error Handling — Senior Engineer's Guide

> The quality of your error handling determines whether incidents take 5 minutes or 5 hours to resolve.

## Error Classification (Impact: high)

### Incorrect
```javascript
// Generic catch-all that hides the actual problem
try {
  await doSomething()
} catch (e) {
  console.log("Error:", e)
  res.status(500).json({ error: "Internal server error" })
}
```

### Correct
```javascript
// Classify errors by recoverability
class AppError extends Error {
  constructor(message, code, statusCode, isOperational = true) {
    super(message)
    this.code = code           // machine-readable: "USER_NOT_FOUND"
    this.statusCode = statusCode
    this.isOperational = isOperational  // true = expected, false = bug
  }
}

// Operational: expected failures (bad input, not found, rate limit)
throw new AppError("User not found", "USER_NOT_FOUND", 404)

// Programmer: unexpected bugs → crash + restart (or alert)
// Let these propagate to global handler, never swallow silently
```

## Global Error Handler (Impact: high)

### Incorrect
```javascript
// Each route has its own try/catch with different error shapes
// Some routes return { error: "..." }, others { message: "..." }, others just 500
```

### Correct
```javascript
// Centralized error handler (Express example)
app.use((err, req, res, next) => {
  // Log with context
  logger.error({
    error: err.message,
    code: err.code,
    stack: err.isOperational ? undefined : err.stack,
    requestId: req.id,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
  })

  // Operational error → structured client response
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message }
    })
  }

  // Programmer error → generic 500, never leak internals
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }
  })
})
```

## Structured Logging (Impact: high)

### Incorrect
```javascript
console.log("User " + userId + " logged in from " + ip)
console.log("Error processing order: " + err.message)
// Unstructured, unsearchable, no severity levels
```

### Correct
```javascript
// JSON structured logging (pino, winston, bunyan)
const logger = pino({ level: process.env.LOG_LEVEL || "info" })

logger.info({ userId, ip, action: "login" }, "User authenticated")
logger.error({ orderId, error: err.message, stack: err.stack }, "Order processing failed")
logger.warn({ endpoint: "/legacy", deprecatedAt: "2026-06" }, "Deprecated endpoint called")

// Output:
// {"level":30,"time":1736932200,"userId":"u123","ip":"1.2.3.4","action":"login","msg":"User authenticated"}
```

**Rules:**
- JSON format (machine-parseable by log aggregators)
- Always include: requestId, timestamp, level
- Never log: passwords, tokens, PII (emails OK if needed, SSN/CC never)
- Log at boundaries: incoming request, outgoing response, external API calls

## Request ID Tracing (Impact: medium)

```javascript
// Assign unique ID to every request, propagate through all logs and downstream calls
import { randomUUID } from "crypto"

app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || randomUUID()
  res.setHeader("x-request-id", req.id)
  next()
})

// Every log line includes requestId → can trace entire request lifecycle
// Pass requestId in headers to downstream microservices
```

## Health Check Endpoint (Impact: medium)

```javascript
app.get("/health", async (req, res) => {
  const checks = {
    db: await checkDb(),
    redis: await checkRedis(),
    uptime: process.uptime(),
    memory: process.memoryUsage().heapUsed / 1024 / 1024,
  }
  const healthy = checks.db && checks.redis
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks })
})

// /health/live  → process is running (for K8s liveness probe)
// /health/ready → can serve traffic (for K8s readiness probe)
```

## Observability Stack

```
Logs    → Structured JSON → Fluentd/Vector → Elasticsearch/Loki
Metrics → Prometheus client → Prometheus → Grafana
Traces  → OpenTelemetry SDK → Jaeger/Tempo

Key metrics to export:
- http_requests_total{method, path, status}
- http_request_duration_seconds{method, path}
- db_query_duration_seconds{query_type}
- error_total{type, code}
```

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Swallowing errors silently | Bugs hide until production | Log everything, crash on programmer errors |
| console.log in production | Unsearchable, no levels | Structured JSON logger |
| Stack traces in API response | Security information leak | Only expose in non-production |
| No request ID | Can't trace issues across services | UUID per request, propagate in headers |
| Logging PII | Compliance violation | Scrub sensitive fields before logging |
