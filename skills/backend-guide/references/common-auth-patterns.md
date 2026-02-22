---
title: "Authentication & Authorization Patterns"
impact: high
impactDescription: "Auth bugs are security bugs. A single misconfigured endpoint can expose all user data."
tags: [common, auth, jwt, session, oauth, rbac]
---

# Auth Patterns — Senior Engineer's Guide

> Auth is the one thing you absolutely cannot get wrong. There are no "minor" auth bugs.

## JWT vs Session — Decision

| Factor | JWT (Stateless) | Session (Stateful) |
|--------|-----------------|---------------------|
| Scaling | No shared state needed | Needs session store (Redis) |
| Revocation | Hard (need blocklist) | Easy (delete session) |
| Payload | Can carry claims | Server-side lookup |
| Size | ~800 bytes per request | ~32 byte session ID |
| Best for | Microservices, mobile APIs | Monoliths, web apps |

## JWT Implementation (Impact: high)

### Incorrect
```javascript
// Storing JWT in localStorage — XSS can steal it
localStorage.setItem("token", jwt)

// Never-expiring tokens
jwt.sign({ userId: 1 }, secret)  // no expiresIn!

// Symmetric secret shared across services
jwt.sign(payload, "my-shared-secret")
```

### Correct
```javascript
// HttpOnly cookie (browser can't access via JS)
res.cookie("accessToken", jwt, {
  httpOnly: true,
  secure: true,       // HTTPS only
  sameSite: "strict",  // CSRF protection
  maxAge: 15 * 60 * 1000  // 15 minutes
})

// Short-lived access + long-lived refresh
const accessToken = jwt.sign(
  { sub: user.id, role: user.role },
  privateKey,
  { algorithm: "RS256", expiresIn: "15m" }
)
const refreshToken = crypto.randomUUID()  // opaque, stored server-side

// Asymmetric keys: auth service signs, others verify with public key
jwt.verify(token, publicKey, { algorithms: ["RS256"] })
```

## Token Refresh Flow (Impact: high)

### Incorrect
```
// Client blindly retries with expired token
// Or: refresh token never rotates (stolen refresh = permanent access)
```

### Correct
```
1. Access token expires → 401
2. Client sends refresh token to POST /auth/refresh
3. Server validates refresh token in DB
4. Server issues NEW access token + NEW refresh token (rotation)
5. Server invalidates OLD refresh token
6. If old refresh token is reused → revoke ALL tokens for user (breach detected)
```

## Authorization Middleware (Impact: high)

### Incorrect
```javascript
// Checking auth inside every route handler
app.get("/admin/users", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({})
  // ... duplicated in every admin route
})
```

### Correct
```javascript
// Middleware composition
const requireAuth = (req, res, next) => {
  const user = verifyToken(req.cookies.accessToken)
  if (!user) return res.status(401).json({ error: { code: "UNAUTHENTICATED" } })
  req.user = user
  next()
}

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: { code: "FORBIDDEN" } })
  next()
}

// Clean route definitions
app.get("/admin/users", requireAuth, requireRole("admin"), listUsers)
app.get("/profile", requireAuth, getProfile)
app.get("/public/posts", listPosts)  // no auth needed
```

## RBAC Design

```
# Resource-based permissions (scalable)
permissions = {
  "admin":  ["users:*", "posts:*", "settings:*"],
  "editor": ["posts:read", "posts:write", "posts:delete"],
  "viewer": ["posts:read"],
}

# Check: can(user, "posts:write") → look up user.role in permissions table
# Store permissions in DB, cache in Redis (invalidate on role change)
```

## Password Storage

```
# NEVER: MD5, SHA1, SHA256, plain text, reversible encryption
# ALWAYS: bcrypt (cost 12+), scrypt, or argon2id

# bcrypt example
const hash = await bcrypt.hash(password, 12)       // store this
const match = await bcrypt.compare(input, hash)     // verify

# argon2id (recommended for new projects)
const hash = await argon2.hash(password, { type: argon2.argon2id })
```

## Common Pitfalls

| Pitfall | Impact | Fix |
|---------|--------|-----|
| JWT in localStorage | XSS steals all tokens | HttpOnly secure cookie |
| No token expiry | Stolen token = permanent access | 15min access + refresh rotation |
| Role check in handler | Missed checks = auth bypass | Middleware composition |
| Symmetric JWT across services | One compromised service leaks key | RS256 asymmetric keys |
| No rate limit on /login | Brute force attacks | 5 attempts/min per IP+email |
| Password in logs | Log aggregator leak | Never log request bodies on auth endpoints |
