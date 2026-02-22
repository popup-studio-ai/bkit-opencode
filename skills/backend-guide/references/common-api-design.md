---
title: "REST API Design Principles"
impact: high
impactDescription: "Inconsistent API design causes 40% more client-side bugs and doubles integration time"
tags: [common, api, rest, design, versioning]
---

# API Design — Senior Engineer's Guide

> Your API is a contract. Breaking it costs more than getting it right.

## URL Structure

### Incorrect
```
GET  /getUsers
POST /createUser
GET  /user_by_id/123
POST /api/v1/users/deleteUser/123
```

### Correct
```
GET    /v1/users           # List
POST   /v1/users           # Create
GET    /v1/users/123       # Read
PATCH  /v1/users/123       # Partial update
DELETE /v1/users/123       # Delete
GET    /v1/users/123/posts # Nested resource
```

**Rules:** Nouns (not verbs), plural, lowercase, hyphens for multi-word (`/user-profiles`).

## Error Response Format (Impact: high)

### Incorrect
```json
{ "error": "Something went wrong" }
// or worse
{ "success": false, "msg": "bad request" }
// or even worse
200 OK { "error": true, "message": "Not found" }
```

### Correct
```json
// Use proper HTTP status codes + structured error body
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email format is invalid",
    "details": [
      { "field": "email", "constraint": "Must be valid email format" }
    ],
    "requestId": "req_abc123"
  }
}
```

**Standard status codes:**
- 400: Client sent bad data (validation)
- 401: Not authenticated
- 403: Authenticated but not authorized
- 404: Resource doesn't exist
- 409: Conflict (duplicate)
- 422: Semantically invalid (understood but can't process)
- 429: Rate limited
- 500: Server bug (never expose stack traces)

## Versioning (Impact: high)

### Incorrect
```
# Breaking change with no versioning
GET /users  → response shape changed, all clients break
```

### Correct
```
# URL-based versioning (simplest, recommended)
GET /v1/users
GET /v2/users

# Header-based (when you need it)
GET /users  + Accept: application/vnd.api+json;version=2
```

**Rule:** Never break v1. Add v2 alongside. Deprecate v1 with 6-month sunset.

## Pagination (Impact: medium)

### Incorrect
```
GET /v1/users?page=50
# Page 50 of what? If data changes, pages shift. Slow for large offsets.
```

### Correct
```
# Cursor-based (stable, performant)
GET /v1/users?limit=20&cursor=eyJpZCI6MTIzfQ
→ { "data": [...], "cursor": { "next": "eyJpZCI6MTQzfQ", "hasMore": true } }

# Offset-based (simpler, OK for small datasets < 10k rows)
GET /v1/users?limit=20&offset=40
→ { "data": [...], "total": 150, "limit": 20, "offset": 40 }
```

## Request/Response Conventions

```
# Timestamps: Always ISO 8601 UTC
"createdAt": "2026-01-15T09:30:00Z"     ✓
"createdAt": "01/15/2026"                ✗
"createdAt": 1736932200                  ✗ (ambiguous: seconds? ms?)

# IDs: String (not number). Allows migration to UUID/ULID later.
"id": "usr_abc123"                        ✓
"id": 42                                  ✗

# Null vs absent: Absent = not requested. Null = explicitly empty.
PATCH /users/123 { "nickname": null }     → clear nickname
PATCH /users/123 { }                      → change nothing

# Envelope: Optional but consistent
{ "data": {...}, "meta": { "requestId": "..." } }
```

## Rate Limiting Headers

```
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1736932200
```
