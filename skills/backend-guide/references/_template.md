---
title: "{Framework} Best Practices & Infra Guide"
impact: high
impactDescription: "{Quantified impact description}"
tags: [{language}, {framework}, backend]
---

# {Framework} — Senior Engineer's Guide

> {One-line philosophy about this technology}

## When to Choose

**Choose when:**
- {Situation 1}
- {Situation 2}

**Avoid when:**
- {Situation 1}
- {Situation 2}

**Honest trade-off:** {What you give up by choosing this}

## Project Structure

```
project/
├── src/
│   ├── ...
```

## Best Practices

### {Practice Title} (Impact: high)

#### Incorrect
```{language}
// {Why this is wrong}
{bad code}
```

#### Correct
```{language}
// {Why this is right}
{good code}
```

**Why it matters:** {Production impact explanation}

### {Practice Title 2} (Impact: medium)

#### Incorrect
```{language}
{bad code}
```

#### Correct
```{language}
{good code}
```

## Infrastructure & Deployment

### Docker
```dockerfile
{Dockerfile}
```

### Scaling Strategy
{How to scale this stack}

### Monitoring
{What to monitor}

## Performance

| Metric | Typical | Optimized |
|--------|---------|-----------|
| Cold start | {x}ms | {y}ms |
| Throughput | {x} rps | {y} rps |
| Memory | {x}MB | {y}MB |

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| {Pitfall 1} | {What you see} | {How to fix} |
