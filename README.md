# bkit-opencode - Vibecoding Kit for OpenCode

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![OpenCode](https://img.shields.io/badge/OpenCode-Plugin-purple.svg)](https://github.com/anomalyco/opencode)
[![npm](https://img.shields.io/npm/v/bkit-opencode.svg)](https://www.npmjs.com/package/bkit-opencode)
[![Author](https://img.shields.io/badge/Author-POPUP%20STUDIO-orange.svg)](https://popupstudio.ai)

> **PDCA methodology + CTO-Led Agent Teams + AI coding assistant mastery for AI-native development**

bkit-opencode is an [OpenCode](https://github.com/anomalyco/opencode) plugin that transforms how you build software with AI. It provides structured development workflows, automatic documentation, and intelligent code assistance through the PDCA (Plan-Do-Check-Act) methodology.

> Also available for Claude Code: [bkit-claude-code](https://github.com/popup-studio-ai/bkit-claude-code)

---

## What is Context Engineering?

**Context Engineering** is the systematic curation of context tokens for optimal LLM inference - going beyond simple prompt crafting to build entire systems that consistently guide AI behavior.

```
Traditional Prompt Engineering:
  "The art of writing good prompts"

Context Engineering:
  "The art of designing systems that integrate prompts, tools, and state
   to provide LLMs with optimal context for inference"
```

**bkit is a practical implementation of Context Engineering**, providing a systematic context management system for OpenCode.

### bkit's Context Engineering Architecture

bkit implements Context Engineering through three interconnected layers:

| Layer | Components | Purpose |
|-------|------------|---------|
| **Domain Knowledge** | 28 Skills | Structured expert knowledge (phases, levels, specialized domains) |
| **Behavioral Rules** | 17 Agents | Role-based constraints with model selection (opus/sonnet/haiku) |
| **State Management** | TypeScript Library | PDCA status, intent detection, ambiguity scoring, team coordination |

### Hook-Based Context Injection

Context injection occurs through OpenCode's plugin hook system:

```
Hook 1: config                                → Agent/skill/MCP registration, permissions
Hook 2: event                                 → PDCA init, level detection, team state
Hook 3: chat.message                          → Intent detection, skill/agent triggers
Hook 4: tool.execute.before                   → Skill activation, tool constraints
Hook 5: tool.execute.after                    → PDCA phase auto-advance, document tracking
Hook 6: experimental.chat.system.transform    → PDCA status injection, next-step guidance
Hook 7: experimental.session.compacting       → State preservation across context compaction
Hook 8: permission.ask                        → Dangerous command filtering
```

> **Learn more**: See [AI-NATIVE-DEVELOPMENT.md](AI-NATIVE-DEVELOPMENT.md) for detailed methodology.

---

## Features

- **PDCA Methodology** - Structured development workflow with automatic documentation
- **CTO-Led Agent Teams** - CTO agent orchestrates parallel PDCA execution with multi-agent teams (Dynamic: 3, Enterprise: 5 teammates)
- **Plan Plus Skill** - Brainstorming-enhanced PDCA planning with intent discovery and YAGNI review
- **Evaluator-Optimizer Pattern** - Automatic iteration cycles from Anthropic's agent architecture
- **9-Stage Development Pipeline** - From schema design to deployment
- **3 Project Levels** - Starter (static), Dynamic (fullstack), Enterprise (microservices)
- **Multilingual Support** - 8 languages (EN, KO, JA, ZH, ES, FR, DE, IT)
- **28 Skills** - Domain-specific knowledge for various development scenarios
- **17 Agents** - Specialized AI assistants including CTO-Led Team agents
- **Check-Act Iteration Loop** - Automatic gap analysis and fix cycles with max 5 iterations (90% threshold)
- **bkend.ai BaaS Integration** - Backend-as-a-Service skills for fullstack development

---

## Requirements

| Requirement | Minimum Version | Notes |
|-------------|:---------------:|-------|
| **OpenCode** | 0.1+ | Required. bkit uses `@opencode-ai/plugin` ^1.2.4 |
| **Bun** | 1.3+ | OpenCode's runtime |

---

## Installation

Add bkit-opencode to your project's `opencode.json`:

```jsonc
// opencode.json (or .opencode/opencode.json)
{
  "plugin": ["bkit-opencode"]
}
```

OpenCode will automatically install the plugin from npm on next launch.

### Manual Installation (Development)

```bash
# Clone for local development
git clone https://github.com/popup-studio-ai/bkit-opencode.git
```

Then add as a local plugin in your project's `opencode.json`:

```jsonc
{
  "plugin": ["file:///path/to/bkit-opencode/src/index.ts"]
}
```

---

## Plugin Structure

```
bkit-opencode/
├── agents/                  # 17 specialized AI agents
│   ├── cto-lead.md          # Team orchestrator (opus tier)
│   ├── code-analyzer.md     # Code quality analysis (opus tier)
│   ├── gap-detector.md      # Design-implementation gap detection (opus tier)
│   ├── frontend-architect.md # UI/UX architecture (sonnet tier)
│   └── ...                  # 13 more agents
├── skills/                  # 28 domain-specific skills
│   ├── pdca/SKILL.md        # Unified PDCA with 8 actions
│   ├── plan-plus/SKILL.md   # Enhanced planning with brainstorming
│   ├── starter/SKILL.md     # Static web development
│   ├── dynamic/SKILL.md     # Fullstack with BaaS
│   ├── enterprise/SKILL.md  # Microservices architecture
│   └── ...                  # 23 more skills
├── src/                     # TypeScript plugin source
│   ├── index.ts             # Plugin entry point
│   ├── hooks/               # 8 hook handlers
│   ├── tools/               # 8 custom tools
│   └── lib/                 # Core libraries
│       ├── core/            # Config, cache, platform, debug
│       ├── pdca/            # Status, level, phase, automation
│       ├── intent/          # Trigger detection, ambiguity, language
│       ├── task/            # Classification, tracking, delegation
│       └── team/            # Coordination, orchestration, mailbox
├── templates/               # 17 document templates
│   ├── plan.template.md
│   ├── design.template.md
│   ├── analysis.template.md
│   └── pipeline/            # 9-phase pipeline templates
├── bkit.config.json         # Centralized configuration
└── package.json
```

---

## Quick Start

### 1. Initialize a Project

```bash
/starter      # Static website (Starter level)
/dynamic      # Fullstack with BaaS (Dynamic level)
/enterprise   # Microservices with K8s (Enterprise level)
```

### 2. PDCA Workflow

```bash
/pdca plan {feature}     # Create plan document
/pdca design {feature}   # Create design document
/pdca do {feature}       # Implementation guide
/pdca analyze {feature}  # Run gap analysis
/pdca iterate {feature}  # Auto-fix with Evaluator-Optimizer pattern
/pdca report {feature}   # Generate completion report
/pdca status             # Check current PDCA status
/pdca next               # Guide to next PDCA step
```

### 3. CTO-Led Agent Teams

```bash
# Start CTO Team for a feature
/pdca team {feature}
```

**How it works:**
1. CTO lead agent analyzes the feature and selects the optimal team composition
2. Teammates are spawned in parallel (Dynamic: 3, Enterprise: 5 agents)
3. Each teammate handles a specific area (QA, frontend, backend, security, etc.)
4. CTO orchestrates task assignment, progress monitoring, and result aggregation

---

## Configuration

### Model Configuration

bkit uses a tier-based model system. Configure models in your project's `bkit.config.json`:

```jsonc
// bkit.config.json (in project root)
{
  "models": {
    "opus": { "providerID": "anthropic", "modelID": "claude-opus-4" },
    "sonnet": { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" },
    "haiku": { "providerID": "anthropic", "modelID": "claude-haiku-4-5" }
  }
}
```

If no models are configured, agents use OpenCode's default model.

**Agent Tier Mapping:**

| Tier | Agents | Use Case |
|------|--------|----------|
| **opus** | cto-lead, gap-detector, code-analyzer, security-architect, enterprise-expert, infra-architect | Complex analysis, orchestration |
| **sonnet** | frontend-architect, backend-expert, baas-expert, product-manager, qa-strategist, design-validator, pdca-iterator, starter-guide, pipeline-guide | Implementation, review |
| **haiku** | qa-monitor, report-generator | Monitoring, reporting |

### PDCA Configuration

```jsonc
{
  "pdca": {
    "matchRateThreshold": 90,    // Gap analysis pass threshold (%)
    "autoIterate": true,          // Auto-improvement when < threshold
    "maxIterations": 5            // Max iteration cycles
  }
}
```

---

## Customization

> **Comprehensive Guide**: See **[CUSTOMIZATION-GUIDE.md](CUSTOMIZATION-GUIDE.md)** for detailed instructions.

### How It Works

OpenCode searches for configuration in this priority order:
1. **User's `opencode.json`** agent/skill config (highest priority)
2. **Project `.opencode/agents/` and `.opencode/skill/`** (user overrides)
3. **Plugin defaults** (bkit-opencode)

### Override an Agent

Create a file with the same name in `.opencode/agents/`:

```bash
# Copy and customize an agent
mkdir -p .opencode/agents
# Create .opencode/agents/cto-lead.md with your custom prompt
```

### Override a Skill

Add skills to `.opencode/skill/`:

```bash
mkdir -p .opencode/skill/my-custom-skill
# Create .opencode/skill/my-custom-skill/SKILL.md
```

---

## Project Levels

| Level | Description | Stack | Detection |
|-------|-------------|-------|-----------|
| **Starter** | Static websites, portfolios | HTML, CSS, JS | Default |
| **Dynamic** | Fullstack applications | Next.js, BaaS | `api/`, `supabase/`, `@bkend` |
| **Enterprise** | Microservices architecture | K8s, Terraform, MSA | `kubernetes/`, `terraform/`, `Dockerfile` |

---

## Agents

| Agent | Tier | Role |
|-------|------|------|
| cto-lead | opus | Team orchestration, PDCA workflow management |
| code-analyzer | opus | Code quality, security, and performance analysis |
| gap-detector | opus | Design-implementation synchronization check |
| security-architect | opus | Vulnerability analysis, auth design review |
| enterprise-expert | opus | CTO-level AI-Native development strategy |
| infra-architect | opus | AWS, Kubernetes, Terraform infrastructure design |
| frontend-architect | sonnet | UI/UX design, component architecture |
| backend-expert | sonnet | Backend architecture across all frameworks |
| baas-expert | sonnet | bkend.ai BaaS platform integration |
| product-manager | sonnet | Requirements analysis, feature prioritization |
| qa-strategist | sonnet | Test strategy, quality metrics coordination |
| design-validator | sonnet | Design document completeness validation |
| pdca-iterator | sonnet | Evaluator-Optimizer automatic iteration |
| starter-guide | sonnet | Beginner-friendly step-by-step guidance |
| pipeline-guide | sonnet | 9-phase development pipeline guidance |
| qa-monitor | haiku | Docker log monitoring, Zero Script QA |
| report-generator | haiku | PDCA completion report generation |

---

## Skills

### PDCA Skills
- `pdca` - Unified PDCA with 8 actions (plan, design, do, analyze, iterate, report, status, next)
- `plan-plus` - Brainstorming-enhanced planning
- `bkit-rules` - Core PDCA automation rules
- `bkit-templates` - Document template reference

### Level Skills
- `starter` - Static web development
- `dynamic` - Fullstack with BaaS
- `enterprise` - Microservices architecture

### Pipeline Skills (9 phases)
- `phase-1-schema` through `phase-9-deployment`
- `development-pipeline` - Pipeline overview and navigation

### Backend Skills
- `bkend-quickstart` - bkend.ai onboarding
- `bkend-auth` - Authentication and security
- `bkend-data` - Database operations
- `bkend-storage` - File storage
- `bkend-cookbook` - Practical tutorials
- `backend-guide` - Multi-framework backend reference

### Utility Skills
- `code-review` - Code quality analysis
- `zero-script-qa` - Log-based testing without scripts
- `opencode-learning` - OpenCode learning guide
- `mobile-app` - React Native / Flutter
- `desktop-app` - Electron / Tauri

---

## Language Support

bkit automatically detects your language from trigger keywords:

| Language | Trigger Keywords |
|----------|-----------------|
| English | static website, beginner, API design |
| Korean | 정적 웹, 초보자, API 설계 |
| Japanese | 静的サイト, 初心者, API設計 |
| Chinese | 静态网站, 初学者, API设计 |
| Spanish | sitio web estatico, principiante |
| French | site web statique, debutant |
| German | statische Webseite, Anfanger |
| Italian | sito web statico, principiante |

---

## Documentation

- **[CUSTOMIZATION-GUIDE.md](CUSTOMIZATION-GUIDE.md)** - Complete customization guide
- **[AI-NATIVE-DEVELOPMENT.md](AI-NATIVE-DEVELOPMENT.md)** - AI-Native methodology
- **[CHANGELOG.md](CHANGELOG.md)** - Version history
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines

---

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Copyright 2024-2026 POPUP STUDIO PTE. LTD.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

You must include the [NOTICE](NOTICE) file in any redistribution.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/popup-studio-ai/bkit-opencode/issues)
- **Email**: contact@popupstudio.ai
- **Claude Code version**: [bkit-claude-code](https://github.com/popup-studio-ai/bkit-claude-code)

---

Made with AI by [POPUP STUDIO](https://popupstudio.ai)
