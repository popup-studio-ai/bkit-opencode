---
title: "Backend Testing Strategy"
impact: high
impactDescription: "Untested backends break silently. A proper test pyramid catches 90% of bugs before deployment."
tags: [common, testing, unit, integration, e2e, tdd]
---

# Testing Strategy — Senior Engineer's Guide

> Ship without tests and you're just transferring QA to your users.

## Test Pyramid

```
         /  E2E  \           5-10%  (critical paths only)
        /----------\
       / Integration \       20-30% (API + DB boundaries)
      /----------------\
     /    Unit Tests     \   60-70% (business logic, pure functions)
    /____________________\
```

## Unit Tests (Impact: high)

### Incorrect
```javascript
// Testing implementation details, not behavior
test("calls database", () => {
  const spy = jest.spyOn(db, "query")
  getUser(1)
  expect(spy).toHaveBeenCalledWith("SELECT * FROM users WHERE id = $1", [1])
  // Breaks when you optimize the query, even if behavior is correct
})
```

### Correct
```javascript
// Test behavior: input → output
test("returns user by id", async () => {
  const mockRepo = { findById: jest.fn().mockResolvedValue({ id: 1, name: "Kim" }) }
  const service = new UserService(mockRepo)

  const user = await service.getUser(1)

  expect(user).toEqual({ id: 1, name: "Kim" })
})

test("throws NOT_FOUND when user doesn't exist", async () => {
  const mockRepo = { findById: jest.fn().mockResolvedValue(null) }
  const service = new UserService(mockRepo)

  await expect(service.getUser(999)).rejects.toThrow("USER_NOT_FOUND")
})
```

**Unit test rules:**
- Test public behavior, not internal implementation
- One assertion per concept (multiple `expect` is fine if testing one behavior)
- No real DB, network, or filesystem — mock boundaries
- Fast: entire unit suite < 10 seconds

## Integration Tests (Impact: high)

### Incorrect
```javascript
// Mocking everything = testing nothing
test("create user API", async () => {
  jest.mock("../db")       // mocked
  jest.mock("../email")    // mocked
  jest.mock("../auth")     // mocked
  // Congratulations, you tested that mocks return what you told them to
})
```

### Correct
```javascript
// Real DB (test container), real middleware, mock only external services
describe("POST /v1/users", () => {
  beforeAll(async () => {
    await testDb.migrate()   // real database, clean schema
  })

  afterEach(async () => {
    await testDb.truncate("users")  // clean between tests
  })

  test("creates user and returns 201", async () => {
    const res = await request(app)
      .post("/v1/users")
      .send({ email: "test@example.com", name: "Test" })

    expect(res.status).toBe(201)
    expect(res.body.data.id).toBeDefined()

    // Verify actually in DB
    const user = await testDb.query("SELECT * FROM users WHERE email = $1", ["test@example.com"])
    expect(user.rows).toHaveLength(1)
  })

  test("returns 409 on duplicate email", async () => {
    await request(app).post("/v1/users").send({ email: "dupe@example.com", name: "First" })
    const res = await request(app).post("/v1/users").send({ email: "dupe@example.com", name: "Second" })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe("DUPLICATE_EMAIL")
  })
})
```

**Integration test rules:**
- Real DB (use testcontainers or docker-compose test profile)
- Real HTTP through the router
- Mock only truly external services (email, payment, third-party APIs)
- Each test is independent (setup/teardown)

## E2E Tests (Impact: medium)

```javascript
// Only for critical business flows
describe("User signup → login → create post flow", () => {
  test("full user journey", async () => {
    // Signup
    const signup = await request(app).post("/v1/auth/signup")
      .send({ email: "e2e@test.com", password: "StrongP@ss1" })
    expect(signup.status).toBe(201)

    // Login
    const login = await request(app).post("/v1/auth/login")
      .send({ email: "e2e@test.com", password: "StrongP@ss1" })
    const token = login.body.data.accessToken

    // Create post (authenticated)
    const post = await request(app).post("/v1/posts")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "My Post", content: "Hello world" })
    expect(post.status).toBe(201)
  })
})
```

## Test Configuration

```
# Environment separation
.env.test                    # Test-specific config
  DATABASE_URL=postgres://localhost:5433/test_db
  LOG_LEVEL=silent           # Don't pollute test output
  JWT_SECRET=test-secret

# Scripts
"test":        "jest --runInBand",          # unit + integration
"test:unit":   "jest --testPathPattern=unit",
"test:int":    "jest --testPathPattern=integration --runInBand",
"test:e2e":    "jest --testPathPattern=e2e --runInBand",
"test:ci":     "docker compose -f docker-compose.test.yml up -d && jest --runInBand && docker compose -f docker-compose.test.yml down"
```

## What to Test (Priority)

| Priority | What | Why |
|----------|------|-----|
| **P0** | Auth (login, signup, token refresh) | Security-critical |
| **P0** | Payment/billing flows | Money-critical |
| **P1** | Core CRUD operations | Business-critical |
| **P1** | Input validation | Prevents bad data |
| **P2** | Error handling paths | Graceful degradation |
| **P2** | Edge cases (empty, null, max length) | Data integrity |
| **P3** | Admin operations | Lower frequency |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Mocking everything | Tests pass but prod breaks | Integration tests with real DB |
| Tests depend on order | Flaky: pass alone, fail together | Independent setup/teardown |
| Slow test suite | Devs skip running tests | Separate unit (fast) from integration |
| Testing framework internals | Breaks on library upgrade | Test your code's behavior only |
| No CI test step | Broken code reaches main | Tests must pass before merge |
