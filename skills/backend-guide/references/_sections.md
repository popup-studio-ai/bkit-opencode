---
title: Section Definitions
---

# Backend Guide Reference Sections

## Categories

### language-specific
Language and framework-specific best practices, project structure, and infra deployment.
Each file covers one framework end-to-end: when to use, patterns, anti-patterns, infra, pitfalls.

**Impact levels:**
- **high**: Causes production incidents or significant performance degradation if ignored
- **medium**: Leads to maintenance burden, tech debt, or developer friction
- **low**: Style/convention preferences that improve consistency

### common
Cross-cutting backend concerns that apply regardless of language choice.
API design, auth, database, error handling, testing.

### meta
_sections.md (this file) and _template.md for adding new references.

## File Naming Convention

- Language-specific: `{language}-{framework}.md` (e.g., `node-express.md`, `python-fastapi.md`)
- Common: `common-{topic}.md` (e.g., `common-api-design.md`)
- Meta frameworks: `{name}-api.md` or `{name}-runtime.md`

## Standard Reference Structure

Each reference follows this structure:
1. Frontmatter (title, impact, impactDescription, tags)
2. One-line philosophy quote
3. When to Choose (honest trade-offs)
4. Project Structure (opinionated layout)
5. Best Practices (Incorrect/Correct with impact)
6. Infrastructure & Deployment
7. Performance Considerations
8. Common Pitfalls (production war stories)
