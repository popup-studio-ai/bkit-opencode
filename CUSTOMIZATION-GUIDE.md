# OpenCode Plugin Customization Guide

A comprehensive guide to customizing bkit-opencode for your organization, using bkit as a reference implementation.

---

## Table of Contents

**Part I: Understanding bkit**
1. [bkit Design Philosophy](#1-bkit-design-philosophy)
2. [Why bkit is Well-Designed](#2-why-bkit-is-well-designed)
3. [Supported Languages & Frameworks](#3-supported-languages--frameworks)

**Part II: Plugin Architecture**
4. [Understanding Plugin Architecture](#4-understanding-plugin-architecture)
5. [Configuration Hierarchy](#5-configuration-hierarchy)
6. [Plugin Components Overview](#6-plugin-components-overview)

**Part III: Customization Guide**
7. [Customizing Agents](#7-customizing-agents)
8. [Customizing Skills](#8-customizing-skills)
9. [Customizing Models](#9-customizing-models)
10. [Customizing Templates](#10-customizing-templates)
11. [Customizing Hooks](#11-customizing-hooks)
12. [Organization-Specific Customization](#12-organization-specific-customization)

**Part IV: Reference**
13. [Best Practices](#13-best-practices)
14. [License & Attribution](#14-license--attribution)

---

## 1. bkit Design Philosophy

Before customizing bkit, understanding its design intent helps you make better decisions about what to adapt and what to keep.

### Core Mission

> **"Enable all developers using OpenCode to naturally adopt 'document-driven development' and 'continuous improvement' even without knowing commands or PDCA methodology"**

In essence: **AI guides humans toward good development practices**.

### Three Core Philosophies

| Philosophy | Description | Implementation |
|------------|-------------|----------------|
| **Automation First** | AI automatically applies PDCA even if user doesn't know commands | `bkit-rules` skill + tool hooks |
| **No Guessing** | If unsure, check docs → If not in docs, ask user (never guess) | Design-first workflow, `gap-detector` agent |
| **Docs = Code** | Design first, implement later (maintain design-implementation sync) | PDCA workflow + `/pdca analyze` command |

---

## 2. Why bkit is Well-Designed

### Layered Trigger System

```
Hook 1: config              → Agent/skill registration at startup
Hook 2: session (event)     → Per-session state initialization
Hook 3: chat.message        → Intent detection, auto-triggering
Hook 4: tool.execute.before → Guard rails, skill constraints
Hook 5: tool.execute.after  → Auto-advance, document tracking
Hook 6: system-prompt       → Dynamic context injection
Hook 7: compaction          → State preservation
Hook 8: permission          → Security filtering
```

### Level-Based Adaptation

bkit automatically adjusts its behavior based on detected project complexity:

| Level | Detection | Behavior |
|-------|-----------|----------|
| **Starter** | Simple HTML/CSS structure | Friendly explanations, simplified PDCA |
| **Dynamic** | Next.js + BaaS indicators | Technical but clear, full PDCA |
| **Enterprise** | K8s/Terraform/microservices | Concise, architecture-focused |

### PDCA Within Each Phase

```
Pipeline Phase (e.g., API Implementation)
├── Plan: Define requirements
├── Design: Write spec
├── Do: Implement
├── Check: Gap analysis
└── Act: Document learnings
```

Each of the 9 pipeline phases runs its own PDCA cycle.

---

## 3. Supported Languages & Frameworks

bkit is **language and framework agnostic**. The PDCA methodology works with any technology stack.

### Built-in Support

| Category | Technologies |
|----------|-------------|
| **Frontend** | React, Next.js, Vue, Nuxt, Svelte, SolidJS, Angular |
| **Backend** | Node.js (Express/NestJS), Python (FastAPI/Django), Go, Rust, Java (Spring), Ruby (Rails) |
| **Mobile** | React Native, Flutter, Expo |
| **Desktop** | Electron, Tauri |
| **Infrastructure** | Kubernetes, Terraform, Docker, AWS |
| **BaaS** | bkend.ai, Supabase, Firebase |

---

## 4. Understanding Plugin Architecture

### How bkit-opencode Works with OpenCode

bkit-opencode is a standard OpenCode plugin distributed via npm:

```
User adds to opencode.json → OpenCode auto-installs from npm
→ Plugin loaded from node_modules/bkit-opencode/src/index.ts
→ Plugin returns Hooks object implementing @opencode-ai/plugin interface
→ Config hook registers agents, skills, tools, permissions
```

### Plugin Loading Flow

```
1. OpenCode starts
2. Reads opencode.json → finds "bkit-opencode" in plugin array
3. Runs `bun install bkit-opencode` (if not installed)
4. Imports src/index.ts → calls plugin function with PluginInput
5. Plugin returns Hooks → OpenCode registers all hooks
6. Config hook runs → mutates config to add agents/skills/tools
7. Agent.state() reads config.agent → agents available
8. Skill.state() reads config.skills.paths → skills available
```

### Plugin Directory Structure

When installed via npm:

```
node_modules/bkit-opencode/
├── src/index.ts          # Entry point
├── agents/*.md           # Agent definitions (loaded by config hook)
├── skills/*/SKILL.md     # Skill definitions (loaded by config hook)
├── templates/            # Document templates
└── bkit.config.json      # Default configuration
```

---

## 5. Configuration Hierarchy

### Priority Order (highest to lowest)

| Priority | Location | Description |
|----------|----------|-------------|
| 1 | `opencode.json` agent config | User's direct agent/model overrides |
| 2 | `.opencode/agents/*.md` | User's custom agent files |
| 3 | `.opencode/skill/*/SKILL.md` | User's custom skills |
| 4 | Project `bkit.config.json` | Project-level bkit config |
| 5 | Plugin `bkit.config.json` | Plugin defaults |

### OpenCode Config Locations

```
~/.config/opencode/opencode.json     # Global config
<project>/opencode.json              # Project config
<project>/.opencode/opencode.json    # Project .opencode config
```

---

## 6. Plugin Components Overview

### Agents (17)

Agent `.md` files with YAML frontmatter + markdown prompt:

```yaml
---
name: my-agent
description: When to use this agent
temperature: 0.3
mode: subagent
---

# Agent System Prompt

Instructions in Markdown format...
```

**Fields:**
- `name` - Agent identifier
- `description` - Shown to AI for agent selection
- `temperature` - LLM temperature (0.0-1.0)
- `mode` - `subagent` (spawned by other agents), `primary` (user-facing), or `all`
- `hidden` - Hide from agent list
- `steps` - Max execution steps
- `color` - Display color

### Skills (28)

Skill directories with `SKILL.md` containing YAML frontmatter + instructions:

```yaml
---
name: my-skill
description: Triggers and usage description
allowed-tools: ["Read", "Write", "Bash"]
---

# Skill Instructions

Content with $1, $ARGUMENTS placeholders for user input
```

### Tools (8 custom)

TypeScript tools using `@opencode-ai/plugin` SDK:

- `bkit-pdca-status` - PDCA workflow management
- `bkit-level-info` - Project level configuration
- `bkit-agent-activity` - Agent activity tracking
- `bkit-agent-mailbox` - Inter-agent messaging
- `bkit-agent-monitor` - Agent status monitoring
- `bkit-task-board` - CTO task management
- `agent` - Agent delegation
- `agent_result` - Background agent results

### Templates (17)

Markdown templates with `{feature}`, `{level}`, `{date}` variables:

```
templates/
├── plan.template.md           # Plan document
├── design.template.md         # Design document (Dynamic)
├── design-starter.template.md # Design document (Starter)
├── design-enterprise.template.md # Design document (Enterprise)
├── analysis.template.md       # Gap analysis report
├── report.template.md         # Completion report
├── do.template.md             # Implementation guide
├── pipeline/                  # 9-phase templates
└── shared/                    # Reusable patterns
```

---

## 7. Customizing Agents

### Override an Existing Agent

Create a file with the **same name** in `.opencode/agents/`:

```bash
mkdir -p .opencode/agents

# Create your custom version
cat > .opencode/agents/cto-lead.md << 'EOF'
---
name: cto-lead
description: Custom CTO agent for my organization
temperature: 0.2
mode: all
---

# Custom CTO Lead

Your custom instructions here...
EOF
```

OpenCode will use your version instead of the plugin's.

### Add a New Agent

```bash
cat > .opencode/agents/my-reviewer.md << 'EOF'
---
name: my-reviewer
description: Code review specialist for our team conventions
temperature: 0.3
mode: subagent
---

# Code Reviewer

Review code following our team's conventions...
EOF
```

### Configure Agent Model via opencode.json

```jsonc
// opencode.json
{
  "agent": {
    "cto-lead": {
      "model": "anthropic/claude-opus-4"
    },
    "code-analyzer": {
      "model": "openai/gpt-4-turbo"
    }
  }
}
```

---

## 8. Customizing Skills

### Add a New Skill

```bash
mkdir -p .opencode/skill/my-review

cat > .opencode/skill/my-review/SKILL.md << 'EOF'
---
name: my-review
description: Custom code review process for our team
---

# Code Review Process

When reviewing code for our project:

1. Check naming conventions
2. Verify error handling
3. Ensure test coverage
EOF
```

### Override a Plugin Skill

Skills are resolved by path. To override, add a skill with the same name to `.opencode/skill/`:

```bash
mkdir -p .opencode/skill/pdca
# Create your custom SKILL.md
```

---

## 9. Customizing Models

### Tier-Based Model System

bkit maps agents to tiers (opus/sonnet/haiku). Configure your preferred models per tier:

```jsonc
// bkit.config.json (project root)
{
  "models": {
    "opus": { "providerID": "anthropic", "modelID": "claude-opus-4" },
    "sonnet": { "providerID": "openrouter", "modelID": "google/gemini-2.5-pro" },
    "haiku": { "providerID": "openai", "modelID": "gpt-4o-mini" }
  }
}
```

### How Model Resolution Works

```
1. Check bkit.config.json models → tier mapping → resolved model
2. If no tier config → check agent .md frontmatter model field
3. If no frontmatter model → use OpenCode's default model
```

### Per-Agent Override

Override a specific agent's model in `opencode.json`:

```jsonc
{
  "agent": {
    "gap-detector": {
      "model": "anthropic/claude-opus-4"
    }
  }
}
```

---

## 10. Customizing Templates

### Override a Template

Copy the template to your project and modify:

```bash
mkdir -p templates
cp node_modules/bkit-opencode/templates/design.template.md templates/
# Edit templates/design.template.md
```

Then update `bkit.config.json` to point to your templates directory.

### Template Variables

| Variable | Description |
|----------|-------------|
| `{feature}` | Feature name from PDCA command |
| `{level}` | Detected project level |
| `{date}` | Current date |

---

## 11. Customizing Hooks

### Understanding Hook Points

| Hook | When | Use Case |
|------|------|----------|
| `config` | Plugin init | Register agents, skills, tools |
| `event` (session) | Session created/deleted | Initialize state |
| `chat.message` | User sends message | Intent detection, auto-triggers |
| `tool.execute.before` | Before tool runs | Guard rails, validation |
| `tool.execute.after` | After tool runs | Auto-advance, tracking |
| `system-prompt` | System prompt generation | Context injection |
| `compaction` | Context compressed | State preservation |
| `permission` | Permission check | Security filtering |

### Extending via Your Own Plugin

Create a companion plugin that hooks into the same lifecycle:

```typescript
// .opencode/plugin/my-extension.ts
import type { Plugin } from "@opencode-ai/plugin"

const MyExtension: Plugin = async (ctx) => {
  return {
    "tool.execute.after": async ({ input }) => {
      // Add custom post-tool logic
      console.log("Tool executed:", input.tool)
    }
  }
}

export default MyExtension
```

---

## 12. Organization-Specific Customization

### Team-Wide Configuration

Create a shared `bkit.config.json` in your repo:

```jsonc
{
  "models": {
    "opus": { "providerID": "your-provider", "modelID": "your-model" },
    "sonnet": { "providerID": "your-provider", "modelID": "your-model" },
    "haiku": { "providerID": "your-provider", "modelID": "your-model" }
  },
  "pdca": {
    "matchRateThreshold": 95,
    "maxIterations": 3
  },
  "team": {
    "maxTeammates": 3
  }
}
```

### Custom Agent Prompts for Your Domain

```bash
# .opencode/agents/domain-expert.md
---
name: domain-expert
description: Expert in our specific business domain
temperature: 0.3
mode: subagent
---

# Domain Expert for [Your Company]

You are an expert in [your domain]. Follow these conventions:
- [Company-specific coding standards]
- [Domain terminology]
- [Architecture patterns]
```

---

## 13. Best Practices

### Do

- **Start with defaults** - Use bkit as-is before customizing
- **Override selectively** - Only customize what you need
- **Keep agent prompts focused** - Each agent should have one clear role
- **Version control customizations** - Commit `.opencode/agents/` and `bkit.config.json`
- **Check CHANGELOG** - Review updates before upgrading

### Don't

- **Don't modify node_modules** - Changes will be lost on update
- **Don't over-customize** - More customization = more maintenance
- **Don't remove safety hooks** - Permission and security hooks exist for a reason
- **Don't hardcode models** - Use the tier system for flexibility

---

## 14. License & Attribution

### Apache 2.0 License

bkit-opencode is licensed under [Apache License 2.0](LICENSE).

### Attribution Requirements

When creating derivative works:

1. **Include NOTICE file** in any redistribution
2. **Retain copyright notices** from source files
3. **Mark modified files** with prominent change notices
4. **Do not use "bkit" trademark** without permission from POPUP STUDIO PTE. LTD.

### Creating Derivative Plugins

If you fork bkit-opencode to create your own plugin:

```
1. Keep LICENSE and NOTICE files
2. Add your own NOTICE with attribution:
   "Based on bkit-opencode by POPUP STUDIO PTE. LTD."
3. Mark all modified files
4. Choose a different name (don't use "bkit" without permission)
```

---

*bkit-opencode - Vibecoding Kit for OpenCode*
*POPUP STUDIO PTE. LTD. - https://popupstudio.ai*
