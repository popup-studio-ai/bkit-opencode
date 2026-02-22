---
name: bkend-quickstart
description: |
  bkend.ai platform onboarding and core concepts guide.
  Covers MCP setup, resource hierarchy (Org->Project->Environment),
  Tenant vs User model, and first project creation.

  Use proactively when user is new to bkend or asks about initial setup.

  Triggers: bkend setup, first project, bkend start, MCP connect,
  bkend 시작, 처음, 설정, MCP 연결, 프로젝트 생성,
  bkend始め方, 初期設定, MCP接続, bkend入门, 初始设置, MCP连接,
  configuracion bkend, primer proyecto, configuration bkend, premier projet,
  bkend Einrichtung, erstes Projekt, configurazione bkend, primo progetto

  Do NOT use for: specific database/auth/storage operations (use domain-specific skills),
  enterprise infrastructure (use infra-architect).
agent: bkit:baas-expert
---

# bkend.ai Quick Start Guide

## What is bkend.ai

MCP-based BaaS platform providing Database, Authentication, and Storage services.
Manage backend via natural language from AI tools (OpenCode, Cursor, Claude Code).

## Resource Hierarchy

```
Organization (team/billing) -> Project (service unit) -> Environment (dev/staging/prod, data isolation)
```

## Tenant vs User

- **Tenant**: Service builder (OAuth 2.1 auth, MCP/Management API access)
- **User**: App end-user (JWT auth, Service API access)
- One person can have both roles

## MCP Setup (OpenCode)

### Config (opencode.jsonc)

Add to `.opencode/opencode.jsonc` (project) or `~/.config/opencode/opencode.jsonc` (global):

```jsonc
{
  "mcp": {
    "bkend": {
      "type": "remote",
      "url": "https://api.bkend.ai/mcp"
    }
  }
}
```

- `type` must be `"remote"` (OpenCode has no `"http"` or `"sse"` type)
- OpenCode tries StreamableHTTP first, then SSE fallback automatically

### Step-by-Step Guide

1. **Prerequisites**: bkend.ai account (signup at https://console.bkend.ai)
2. **Add config**: Add bkend to `mcp` section in `opencode.jsonc`
3. **Restart OpenCode**: Restart to load new MCP config
4. **OAuth auth**: Run `opencode mcp auth bkend` in terminal — browser opens for OAuth 2.1 + PKCE
5. **Verify connection**: Ask "Show my connected bkend projects" or use `get_context` MCP tool

### Troubleshooting MCP Connection

| Problem | Solution |
|---------|----------|
| `needs_auth` status | Run `opencode mcp auth bkend` in terminal |
| 405 SSE error | Normal — SSE fallback after StreamableHTTP, check OAuth |
| `invalid_redirect_uri` | bkend.ai must whitelist OpenCode's redirect URI (`127.0.0.1:19876`) |
| OAuth popup not appearing | Check browser popup blocker |
| MCP tools not visible | Restart OpenCode, check `opencode.jsonc` syntax |
| Connection lost | Re-authenticate (automatic on next MCP call) |
| Wrong project/env | Use `get_context` to check current session |

### OpenCode OAuth Details

- Redirect URI: `http://127.0.0.1:19876/mcp/oauth/callback`
- Each AI tool (OpenCode, Cursor, Claude Code) has a different OAuth callback port
- bkend.ai server must whitelist each tool's redirect URI separately

## MCP Fixed Tools

| Tool | Purpose |
|------|---------|
| `get_context` | Session context (org/project/env, API endpoint) |
| `search_docs` | Search bkend documentation |
| `get_operation_schema` | Get tool input/output schema |

## Searchable Guides (via search_docs)

| Doc ID | Content |
|--------|---------|
| `1_concepts` | BSON schema, permissions, hierarchy |
| `2_tutorial` | Project~table creation tutorial |

## MCP Project Management Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `backend_org_list` | List organizations | None |
| `backend_project_list` | List projects | organizationId |
| `backend_project_get` | Get project detail | organizationId, projectId |
| `backend_project_create` | Create project | organizationId, name, description? |
| `backend_project_update` | Update project | organizationId, projectId, name?, description? |
| `backend_project_delete` | Delete project (irreversible!) | organizationId, projectId |
| `backend_env_list` | List environments | organizationId, projectId |
| `backend_env_get` | Get environment detail | organizationId, projectId, environmentId |
| `backend_env_create` | Create environment | organizationId, projectId, name |

## MCP Resources (Read-Only)

Lightweight, cached (60s TTL) read-only queries via bkend:// URI:

| URI | Description |
|-----|-------------|
| `bkend://orgs` | Organization list |
| `bkend://orgs/{orgId}/projects` | Project list |
| `bkend://orgs/{orgId}/projects/{pId}/environments` | Environment list |
| `bkend://orgs/{orgId}/projects/{pId}/environments/{eId}/tables` | Table list with schema |

**Tip**: Prefer Resources over Tools for listing operations (lighter, cached).

## First Project Checklist

1. Sign up at bkend.ai -> Create Organization
2. Create Project -> dev environment auto-created
3. Connect MCP -> Add bkend to `opencode.jsonc` mcp section
4. Create first table -> "Create a users table"
5. Start data operations -> CRUD via natural language

## Console URL

```
https://console.bkend.ai
```

## Next Steps

- Database operations: refer to bkend-data skill
- Authentication: refer to bkend-auth skill
- File storage: refer to bkend-storage skill
- Practical tutorials: refer to bkend-cookbook skill

## Official Documentation (Live Reference)

For the latest bkend documentation, use WebFetch:
- Quick Start: https://raw.githubusercontent.com/popup-studio-ai/bkend-docs/main/en/getting-started/02-quick-start.md
- Core Concepts: https://raw.githubusercontent.com/popup-studio-ai/bkend-docs/main/en/getting-started/03-core-concepts.md
- OpenCode Setup: https://raw.githubusercontent.com/popup-studio-ai/bkend-docs/main/en/ai-tools/05-opencode-setup.md
- MCP Overview: https://raw.githubusercontent.com/popup-studio-ai/bkend-docs/main/en/mcp/01-overview.md
- Full TOC: https://raw.githubusercontent.com/popup-studio-ai/bkend-docs/main/SUMMARY.md
