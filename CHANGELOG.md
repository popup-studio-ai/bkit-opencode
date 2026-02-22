# Changelog

All notable changes to bkit-opencode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-22

### Added

- Initial public release of bkit-opencode
- **PDCA Methodology** with 6 phases (Research, Plan, Design, Do, Check, Act)
- **17 Specialized AI Agents** with tier-based model selection (opus/sonnet/haiku)
  - CTO-Lead, Product Manager, Frontend Architect, Backend Expert, BaaS Expert
  - Security Architect, Enterprise Expert, Infra Architect
  - Code Analyzer, Gap Detector, Design Validator, QA Strategist, QA Monitor
  - PDCA Iterator, Report Generator, Starter Guide, Pipeline Guide
- **28 Domain-Specific Skills** covering PDCA, backend, frontend, QA, security, infrastructure
  - PDCA unified skill with 8 actions (plan, design, do, analyze, iterate, report, status, next)
  - Plan Plus skill with brainstorming-enhanced planning
  - 9-stage development pipeline (schema to deployment)
  - bkend.ai BaaS integration skills
  - Code review and Zero Script QA skills
- **Project Level Detection** (Starter/Dynamic/Enterprise) with auto-adaptation
- **CTO-Led Agent Teams** for parallel PDCA execution
  - Dynamic: 3 teammates, Enterprise: 5 teammates
  - Orchestration patterns: leader, swarm, council, watchdog
- **8 Hook System** integrations (config, session, message, tool-before, tool-after, system-prompt, compaction, permission)
- **8 Custom Tools** (pdca-status, level-info, task delegation, mailbox, monitor, task-board)
- **Template System** with level-specific variants (17 templates)
- **Multilingual Support** for 8 languages (EN, KO, JA, ZH, ES, FR, DE, IT)
- **Context Engineering** architecture with layered trigger system
- **Evaluator-Optimizer Pattern** for automatic iteration cycles
- bkend.ai MCP integration (disabled by default)

### Notes

- Adapted from [bkit-claude-code](https://github.com/popup-studio-ai/bkit-claude-code) v1.5.5 for OpenCode compatibility
- Models are user-configurable via `bkit.config.json` (no hardcoded defaults)
- Distributed as npm package: `bkit-opencode`

[1.0.0]: https://github.com/popup-studio-ai/bkit-opencode/releases/tag/v1.0.0
