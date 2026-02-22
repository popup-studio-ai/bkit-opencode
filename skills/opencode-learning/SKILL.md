---
name: opencode-learning
description: |
  OpenCode learning and education skill.
  Teaches users how to configure and optimize OpenCode settings.
  Works across any project and any language.

  Start learning/setup with "learn" or "setup".

  Use proactively when user is new to OpenCode, asks about configuration,
  or wants to improve their OpenCode setup.

  Triggers: learn opencode, opencode setup, opencode.jsonc, hooks, commands, skills,
  how to configure, 오픈코드 배우기, 설정 방법, OpenCode 학습,
  オープンコード学習, 设置方法, how do I use opencode,
  aprender opencode, configuración, cómo configurar,
  apprendre opencode, configuration, comment configurer,
  OpenCode lernen, Konfiguration, wie konfigurieren,
  imparare opencode, configurazione, come configurare

  Do NOT use for: actual coding tasks, debugging, or feature implementation.
# hooks: Managed by hooks/hooks.json (unified-stop.js) - GitHub #9354 workaround
---

# OpenCode Learning Skill

> Master OpenCode configuration and optimization

## Actions

| Action | Description | Example |
|--------|-------------|---------|
| `learn` | Start learning guide | `/opencode-learning learn 1` |
| `setup` | Auto-generate settings | `/opencode-learning setup` |
| `upgrade` | Latest features guide | `/opencode-learning upgrade` |

### learn [level]

Learning content by level:
- **Level 1**: Basics - Writing opencode.jsonc, Using Plan Mode
- **Level 2**: Automation - Commands, Hooks, Permission management
- **Level 3**: Specialization - Agents, Skills, MCP integration
- **Level 4**: Team Optimization - GitHub Action, Team rule standardization
- **Level 5**: PDCA Methodology - bkit methodology learning

### setup

Auto-generate appropriate settings after analyzing current project:
1. Analyze/generate opencode.jsonc configuration
2. Check .opencode/ folder structure
3. Suggest required configuration files

### upgrade

Guide to latest OpenCode features and best practices.

## Learning Levels

### Level 1: Basics (15 min)

```markdown
## What is opencode.jsonc?

A shared knowledge repository for the team. When the AI makes mistakes,
add rules to prevent the same mistakes from recurring.

## Example

# Development Workflow

## Package Management
- **Always use `pnpm`** (`npm`, `yarn` prohibited)

## Coding Conventions
- Prefer `type`, avoid `interface`
- **Never use `enum`** → Use string literal unions

## Prohibited
- ❌ No console.log (use logger)
- ❌ No any type
```

### Level 2: Automation (30 min)

```markdown
## What are Slash Commands?

Execute repetitive daily tasks with `/command-name`.

## Command Location

.opencode/commands/{command-name}.md

## PostToolUse Hook

Auto-formatting after code modification:

// .opencode/opencode.jsonc
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "pnpm format || true"
      }]
    }]
  }
}
```

### Level 3: Specialization (45 min)

```markdown
## What are Sub-agents?

AI agents specialized for specific tasks.

## What are Skills?

Domain-specific expert context. AI auto-references when working on related tasks.

## MCP Integration

Connect external tools (Slack, GitHub, Jira, etc.) via opencode.jsonc `mcp` section.
```

### Level 4: Team Optimization (1 hour)

```markdown
## PR Automation with GitHub Action

Use AI-assisted PR reviews to auto-update documentation.

## Team Rule Standardization

1. Manage opencode.jsonc with Git
2. Add rules during PR review
3. Gradually accumulate team knowledge

## Agent Teams (v1.5.1)

Parallel PDCA execution with multiple AI agents working simultaneously.

Always available in OpenCode (uses Task tool for agent spawning).

Usage:
  /pdca team {feature}     Start team mode
  /pdca team status        Check teammate progress
  /pdca team cleanup       End team session

Team composition by level:
  Dynamic:    2 teammates (developer, qa)
  Enterprise: 4 teammates (architect, developer, qa, reviewer)
```

### Level 5: PDCA Methodology

```markdown
## What is PDCA?

Document-driven development methodology.

Research → Plan → Design → Do → Check → Act

## Folder Structure

docs/
├── 00-research/  # Research (pre-plan/design)
├── 01-plan/      # Planning
├── 02-design/    # Design
├── 03-analysis/  # Analysis
└── 04-report/    # Reports

## Learn More

Use /pdca skill to learn PDCA methodology.
```

### Level 6: Advanced Features (v1.5.1)

```markdown
## Output Styles

Customize how AI responds based on your project level.

Available styles:
  bkit-learning     Best for beginners (learning points, TODO markers)
  bkit-pdca-guide   Best for PDCA workflows (status badges, checklists)
  bkit-enterprise   Best for architects (tradeoff analysis, cost impact)

Usage:
  /output-style              Select interactively
  /output-style bkit-learning  Apply directly

Auto-recommendation:
  Starter → bkit-learning
  Dynamic → bkit-pdca-guide
  Enterprise → bkit-enterprise

## Agent Memory

All bkit agents automatically remember context across sessions.
No configuration needed.

Memory scopes:
  project   9 agents remember per-project context (.opencode/agent-memory/)
  user      2 agents remember cross-project learning (~/.opencode/agent-memory/)

Agents with user-scope memory:
  starter-guide     Remembers your learning progress across projects
  pipeline-guide    Remembers your pipeline preferences globally

## Agent Teams

Parallel PDCA execution for Dynamic and Enterprise projects.
See Level 4 for details.
```

## Output Format

```
📚 OpenCode Learning Complete!

**Current Level**: {level}
**Learned**: {summary}

🎯 Next Steps:
- Continue learning with /opencode-learning learn {next_level}
- Auto-generate settings with /opencode-learning setup
- Check latest trends with /opencode-learning upgrade
```

## Current Settings Analysis

Files to analyze:
- .opencode/opencode.jsonc
- .opencode/agents/
- .opencode/commands/
- .opencode/plugins/
