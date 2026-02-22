---
title: "Database Access Patterns"
impact: high
impactDescription: "Unoptimized DB access is the #1 cause of production performance issues — 80% of slow APIs trace back to the database"
tags: [common, database, connection-pool, migration, n-plus-one, index]
---

# Database Patterns — Senior Engineer's Guide

> Every millisecond of DB latency multiplies by every request. Get this wrong and no amount of horizontal scaling saves you.

## Connection Pooling (Impact: high)

### Incorrect
```javascript
// New connection per request — exhausts DB connection limit under load
app.get("/users", async (req, res) => {
  const conn = await db.connect()  // new connection every time!
  const users = await conn.query("SELECT * FROM users")
  conn.close()
  res.json(users)
})
```

### Correct
```javascript
// Pool created once at startup, shared across requests
const pool = new Pool({
  host: process.env.DB_HOST,
  max: 20,                    // match: DB max_connections / num_instances
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

app.get("/users", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE active = $1", [true])
  res.json(rows)  // connection auto-returned to pool
})
```

**Sizing rule:** `pool_size = (DB max_connections - 5 reserved) / num_app_instances`

## N+1 Query Problem (Impact: high)

### Incorrect
```javascript
// 1 query for posts + N queries for authors = N+1 total
const posts = await db.query("SELECT * FROM posts LIMIT 20")
for (const post of posts) {
  post.author = await db.query("SELECT * FROM users WHERE id = $1", [post.authorId])
  // 20 extra queries! At 5ms each = 100ms wasted
}
```

### Correct
```javascript
// Single query with JOIN
const posts = await db.query(`
  SELECT p.*, u.name as author_name, u.avatar as author_avatar
  FROM posts p
  JOIN users u ON p.author_id = u.id
  LIMIT 20
`)

// Or: batch load (when JOIN is awkward)
const posts = await db.query("SELECT * FROM posts LIMIT 20")
const authorIds = [...new Set(posts.map(p => p.authorId))]
const authors = await db.query("SELECT * FROM users WHERE id = ANY($1)", [authorIds])
const authorMap = new Map(authors.map(a => [a.id, a]))
posts.forEach(p => p.author = authorMap.get(p.authorId))
// 2 queries total, regardless of N
```

## Indexing (Impact: high)

### Incorrect
```sql
-- Filtering on unindexed column → full table scan
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;
-- 1M rows, 500ms+ response time
```

### Correct
```sql
-- Composite index matching the query pattern
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);
-- Same query: 2ms

-- Rule: index columns you WHERE + ORDER BY + JOIN ON
-- Check with EXPLAIN ANALYZE, not guessing
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;
```

**Index rules:**
- Index columns in WHERE, ORDER BY, JOIN ON
- Composite index: high-cardinality column first
- Don't index columns with < 100 distinct values on large tables (except boolean + other)
- Monitor unused indexes (they slow writes)

## Migrations (Impact: medium)

```
# Rules:
1. Every schema change is a versioned migration file
2. Migrations are forward-only in production (no editing past migrations)
3. Destructive changes (drop column) must be backward-compatible:
   Step 1: Deploy code that doesn't use the column
   Step 2: Run migration to drop the column

# File naming:
migrations/
  001_create_users.sql
  002_add_email_index.sql
  003_create_posts.sql

# Never:
- Edit a migration that's been applied to production
- Drop a column that running code still reads
- Add NOT NULL without a DEFAULT on an existing table with data
```

## Transaction Patterns (Impact: medium)

### Incorrect
```javascript
// No transaction: partial writes on failure
await db.query("UPDATE accounts SET balance = balance - 100 WHERE id = $1", [from])
// ← if crash here, money vanishes
await db.query("UPDATE accounts SET balance = balance + 100 WHERE id = $1", [to])
```

### Correct
```javascript
const client = await pool.connect()
try {
  await client.query("BEGIN")
  await client.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [amount, from])
  await client.query("UPDATE accounts SET balance = balance + $1 WHERE id = $2", [amount, to])
  await client.query("COMMIT")
} catch (e) {
  await client.query("ROLLBACK")
  throw e
} finally {
  client.release()
}
```

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| No connection pool | "too many connections" under load | Pool at startup, size per instance |
| N+1 queries | Linear response time growth | JOIN or batch load |
| Missing indexes | Slow queries on large tables | EXPLAIN ANALYZE + targeted indexes |
| SELECT * | Transferring unused columns | Select only needed columns |
| No query timeout | Stuck queries block pool | Set statement_timeout (Postgres: 30s) |
| Schema change without migration | Drift between environments | Always use migration files |
