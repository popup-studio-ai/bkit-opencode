---
title: "Flask Best Practices & Infra Guide"
impact: high
impactDescription: "Misusing Flask globals causes 25% of concurrency bugs in microservices; missing app factory blocks testability entirely"
tags: [python, flask, backend]
---

# Flask — Senior Engineer's Guide

> The micro in microframework means you decide everything — which is a superpower if you're disciplined and a footgun if you're not.

## When to Choose

**Choose when:** You need a lightweight HTTP wrapper for a small service, you want full control over every dependency, or you're wrapping an existing Python library as an API.
**Avoid when:** You need auto-generated API docs (use FastAPI), a full admin panel (use Django), or you're building anything with more than 15 endpoints.
**Honest trade-off:** You get maximum flexibility and minimal overhead but pay with boilerplate for anything beyond basic routing. Every convenience feature is an extension you must evaluate and maintain.

## Project Structure

```
service/
├── app/
│   ├── __init__.py          # create_app() factory — the only right way
│   ├── config.py            # Config classes per environment
│   ├── extensions.py        # db = SQLAlchemy(), cache = Cache() — init without app
│   ├── api/
│   │   ├── __init__.py      # Blueprint registration
│   │   ├── health.py        # /healthz, /readyz — always first
│   │   ├── v1/
│   │   │   ├── users.py     # Blueprint per domain
│   │   │   └── orders.py
│   │   └── errors.py        # Centralized error handlers
│   ├── models/              # SQLAlchemy models if needed
│   ├── services/            # Business logic — no Flask imports here
│   └── utils/
├── tests/
│   ├── conftest.py          # App fixture with test config
│   └── api/
├── wsgi.py                  # Entrypoint: app = create_app()
├── Dockerfile
└── pyproject.toml
```

## Best Practices

### 1. Always Use the Application Factory Pattern (Impact: high)

#### Incorrect
```python
# Module-level app — untestable, can't run multiple configs
from flask import Flask

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = "postgresql://localhost/prod"
db = SQLAlchemy(app)

# Tests can't swap the database — you're stuck with prod config
# Circular imports when models.py imports db from here and this imports models
```

#### Correct
```python
# app/__init__.py
from flask import Flask
from app.extensions import db, migrate, cache
from app.api import register_blueprints

def create_app(config_name="production"):
    app = Flask(__name__)
    app.config.from_object(f"app.config.{config_name.title()}Config")

    # Extensions init — they were created without app in extensions.py
    db.init_app(app)
    migrate.init_app(app, db)
    cache.init_app(app)

    register_blueprints(app)
    register_error_handlers(app)
    return app

# extensions.py — instantiate without app
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

# tests/conftest.py — easy to swap config
@pytest.fixture
def app():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        yield app
        db.drop_all()
```

**Why it matters:** Without the factory pattern, you cannot run tests with a different database, cannot create multiple app instances, and circular imports become inevitable. Every Flask project that grows past 10 files without this pattern requires a painful rewrite.

### 2. Use Blueprints for Route Organization (Impact: high)

#### Incorrect
```python
# All routes in one file — becomes 2000 lines within a month
@app.route("/api/v1/users", methods=["GET"])
def list_users(): ...

@app.route("/api/v1/users/<int:id>", methods=["GET"])
def get_user(id): ...

@app.route("/api/v1/orders", methods=["GET"])
def list_orders(): ...
# 50 more routes in the same file...
```

#### Correct
```python
# api/v1/users.py
from flask import Blueprint, jsonify, request

users_bp = Blueprint("users", __name__, url_prefix="/api/v1/users")

@users_bp.route("", methods=["GET"])
def list_users():
    page = request.args.get("page", 1, type=int)
    users = user_service.list_users(page=page, per_page=20)
    return jsonify([u.to_dict() for u in users])

@users_bp.route("/<int:user_id>", methods=["GET"])
def get_user(user_id):
    user = user_service.get_user(user_id)
    if not user:
        abort(404)
    return jsonify(user.to_dict())

# api/__init__.py
def register_blueprints(app):
    from app.api.v1.users import users_bp
    from app.api.v1.orders import orders_bp
    from app.api.health import health_bp
    app.register_blueprint(users_bp)
    app.register_blueprint(orders_bp)
    app.register_blueprint(health_bp)
```

**Why it matters:** Blueprints give you modular route namespacing, per-blueprint error handlers, and clean import boundaries. A monolithic routes file becomes unmergeable in Git after 3 developers touch it simultaneously.

### 3. Handle Errors Centrally, Not Per-Route (Impact: medium)

#### Incorrect
```python
@users_bp.route("/<int:user_id>")
def get_user(user_id):
    try:
        user = user_service.get_user(user_id)
        if not user:
            return jsonify({"error": "Not found"}), 404
        return jsonify(user.to_dict())
    except DatabaseError:
        return jsonify({"error": "Database error"}), 500
    except Exception:
        return jsonify({"error": "Unknown error"}), 500
    # Repeated in every single handler
```

#### Correct
```python
# api/errors.py
class APIError(Exception):
    def __init__(self, message, status_code=400, payload=None):
        self.message = message
        self.status_code = status_code
        self.payload = payload

def register_error_handlers(app):
    @app.errorhandler(APIError)
    def handle_api_error(error):
        response = {"error": error.message}
        if error.payload:
            response["details"] = error.payload
        return jsonify(response), error.status_code

    @app.errorhandler(404)
    def handle_not_found(error):
        return jsonify({"error": "Resource not found"}), 404

    @app.errorhandler(500)
    def handle_internal(error):
        app.logger.exception("Unhandled exception")
        return jsonify({"error": "Internal server error"}), 500

# Now handlers are clean:
@users_bp.route("/<int:user_id>")
def get_user(user_id):
    user = user_service.get_user(user_id)  # raises APIError(404) if missing
    return jsonify(user.to_dict())
```

**Why it matters:** Inconsistent error formats break client parsing. One endpoint returns `{"error": "..."}`, another returns `{"message": "..."}`, a third returns plain text. Central handlers enforce a contract. We've seen client teams waste weeks debugging format inconsistencies.

### 4. Never Mutate Flask Globals Across Threads (Impact: high)

#### Incorrect
```python
# Module-level mutable state — race condition under gunicorn with threads
_cache = {}

@app.route("/data/<key>")
def get_data(key):
    if key not in _cache:
        _cache[key] = expensive_lookup(key)  # Two threads write simultaneously
    return jsonify(_cache[key])
```

#### Correct
```python
# Use Flask-Caching or thread-safe structures
from app.extensions import cache

@app.route("/data/<key>")
def get_data(key):
    result = cache.get(key)
    if result is None:
        result = expensive_lookup(key)
        cache.set(key, result, timeout=300)
    return jsonify(result)

# Or use flask.g for per-request state (not cross-request):
from flask import g

@app.before_request
def load_user():
    g.current_user = get_user_from_token(request.headers.get("Authorization"))
```

**Why it matters:** Flask runs in multiple threads/processes under gunicorn. Module-level mutable state causes corrupted dicts, phantom reads, and data races that only appear under load. Use `flask.g` for per-request state and Redis/memcached for cross-request caching.

## Infrastructure & Deployment

### Dockerfile
```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
COPY app/ app/
COPY wsgi.py .
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["gunicorn", "wsgi:app", "--bind", "0.0.0.0:8000", "--workers", "4", "--threads", "2"]
```

### Scaling
Flask is synchronous by default — scale with gunicorn workers and threads. Workers = `2*CPU + 1`, threads = 2-4 for I/O-bound work. For async needs, consider `flask[async]` with ASGI or just switch to FastAPI. Flask's sweet spot is services under 1000 RPS where simplicity beats raw throughput. Use Nginx in front for static files and request buffering.

## Performance

| Metric | Typical | Optimized |
|---|---|---|
| Simple JSON endpoint | 3k req/s | 8k req/s (gunicorn + gevent) |
| With SQLAlchemy query | 800 req/s | 2.5k req/s (connection pooling + eager load) |
| Startup time | 0.8s | 0.3s (lazy imports) |
| Memory per worker | 45MB | 30MB (no unused extensions) |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| No app factory pattern | Tests use production DB, circular imports | Always use `create_app()` pattern |
| Using `app.run()` in production | Single-threaded, no crash recovery | Use gunicorn/waitress as WSGI server |
| Storing state in module globals | Intermittent data corruption under load | Use Redis, `flask.g`, or Flask-Caching |
| Missing `APPLICATION_ROOT` config | Reverse proxy routes break with prefix | Set `APPLICATION_ROOT` and use `url_for()` |
| Not setting `SECRET_KEY` properly | Sessions predictable, CSRF bypassable | Generate with `secrets.token_hex(32)`, env var |
| Ignoring request context boundaries | `RuntimeError: working outside of request context` | Use `with app.test_request_context()` in scripts |
