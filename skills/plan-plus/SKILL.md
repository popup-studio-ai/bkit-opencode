---
name: plan-plus
description: |
  Plan Plus — Brainstorming-Enhanced PDCA Planning.
  Combines intent discovery from brainstorming methodology with bkit PDCA's structured planning.
  Produces higher-quality Plan documents by exploring user intent, comparing alternatives,
  and applying YAGNI review before document generation.

  Use proactively when user mentions planning with brainstorming, intent discovery,
  exploring alternatives, or wants a more thorough planning process.

  Triggers: plan-plus, plan plus, brainstorming plan, enhanced plan, deep plan,
  플랜 플러스, 브레인스토밍, 기획, 의도 탐색, 대안 탐색,
  プランプラス, ブレインストーミング, 企画, 意図探索,
  计划加强, 头脑风暴, 深度规划, 意图探索,
  plan mejorado, lluvia de ideas, planificación profunda,
  plan amélioré, remue-méninges, planification approfondie,
  erweiterter Plan, Brainstorming, vertiefte Planung,
  piano migliorato, brainstorming, pianificazione approfondita

  Do NOT use for: simple tasks that don't need planning, code-only changes.
argument-hint: "[feature]"
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - TaskCreate
  - TaskUpdate
  - TaskList
  - AskUserQuestion
next-skill: pdca design
pdca-phase: plan
task-template: "[Plan Plus] {feature}"
---

# Plan Plus — Brainstorming-Enhanced PDCA Planning

> Combines brainstorming's intent discovery with bkit PDCA's structured planning to produce
> higher-quality Plan documents through collaborative dialogue.

## Current Invocation

**Feature:** $1
**Raw Arguments:** $ARGUMENTS

Parse the feature above, then follow the process flow below.
If feature is empty, use the primary feature from PDCA status.

## Overview

Plan Plus enhances the standard `/pdca plan` by adding 4 brainstorming phases before document
generation. This ensures that user intent is fully understood, alternatives are explored,
and unnecessary features are removed before any implementation begins.

**When to use Plan Plus instead of `/pdca plan`:**
- The feature has ambiguous or complex requirements
- Multiple implementation approaches are possible
- You want to ensure YAGNI compliance from the start
- The feature involves significant architectural decisions

## HARD-GATE

<HARD-GATE>
Do NOT write any code, scaffold any project, or invoke any implementation skill
until this entire process is complete and the user has approved the Plan document.
This applies to EVERY feature regardless of perceived simplicity.
A "simple" feature still goes through this process — the design can be short,
but you MUST present it and get approval.

IMPORTANT: "plan" here means WRITING a plan document file. Do NOT use EnterPlanMode.
Directly create/write the file using the Write tool. PDCA plan phase ≠ OpenCode plan mode.
</HARD-GATE>

## Process Flow

```
Phase 0: Context Exploration + Domain Research (automatic)
    ↓
Phase 1: Intent Discovery (1 question at a time)
    ↓
Phase 2: Alternatives Exploration (2-3 approaches)
    ↓
Phase 3: YAGNI Review (multiSelect verification)
    ↓
Phase 4: Incremental Design Validation (section-by-section)
    ↓
Phase 5: Plan Document Generation (plan-plus.template.md)
    ↓
Phase 6: Next Steps → /pdca design {feature}
```

## Phase Details

### Phase 0: Context Exploration + Domain Research (Automatic)

Before asking any questions, explore the current project state AND research the domain:

**Step 0 — Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="plan")`

**Step A — Project Context:**
1. Read opencode.json, package.json, pom.xml, etc. for project information
2. Check recent 5 git commits (understand current work direction)
3. Check existing `docs/01-plan/` documents (prevent duplication)
4. Check `docs/.bkit-memory.json` (check ongoing PDCA status)

**Step B — Backend Approach Check (Dynamic level only):**
5. If the feature involves backend/data/auth and no backend approach is recorded in `.bkit-memory.json`, ask using AskUserQuestion:
   - question: "How would you like to handle the backend?"
   - header: "Backend"
   - options: "BaaS (bkend.ai)" (recommended) / "Custom backend" / "Other BaaS"
   - Save choice to `.bkit-memory.json` as `backendApproach` (only asked once per project)

**Step C — Domain Research:**
6. **Research first**: Use WebSearch and/or Explore agent. The research document MUST cover:
   - **Domain Glossary**: Key domain terms and definitions (→ feeds DU-01 evaluation)
   - **Domain Principles**: Core theories, rules, or conventions of the domain (→ feeds DU-02)
   - **Existing Solutions**: Compare 2-3 existing products/approaches with pros/cons table (→ feeds DU-03)
   - **Tech Stack Candidates**: Compare relevant tech options with rationale (→ feeds TD-01, TD-02)
   - **Sources**: All URLs and references cited (→ feeds RF-01)
7. Save research results to `docs/00-research/{feature}-plan-research.md`

> Share exploration results briefly: "I've reviewed the project state and researched the domain: ..."

**Research Path**: `docs/00-research/{feature}-plan-research.md`

### Phase 1: Intent Discovery (Brainstorming Style)

**Principle: One question at a time, prefer multiple choice**

**IMPORTANT**: You MUST use the `AskUserQuestion` tool (not text output) for each question.
Each question gets its OWN separate `AskUserQuestion` tool call. Wait for the user's response
before proceeding to the next question. Never output options as JSON text — always use the tool.

#### Q1. Core Purpose

Call `AskUserQuestion` with:
- `question`: "{feature}의 핵심 목적은 무엇인가요?" (adapt to user's language)
- `header`: "Core purpose" (max 12 chars)
- `options`: 3-4 choices inferred from Phase 0 context. Each option has `label` (1-5 words) and `description` (1 sentence explaining what it means).
- `multiSelect`: false

#### Q2. Target Users

Call `AskUserQuestion` with:
- `question`: "이 기능의 주요 사용자는 누구인가요?"
- `header`: "Target users"
- `options`: 2-4 user types relevant to the project (e.g., Admin, End user, Developer, External system)
- `multiSelect`: false

#### Q3. Success Criteria (only when ambiguous)

Call `AskUserQuestion` with:
- `question`: "성공 기준은 무엇인가요?"
- `header`: "Success"
- `options`: 2-4 measurable criteria inferred from Q1-Q2 answers
- `multiSelect`: true

#### Q4. Constraints (only when needed)

Only ask if there are clear conflicts, performance requirements, or technical constraints.

> **Important**: Minimize questions. Clear features need only Q1-Q2.
> Only proceed to Q3-Q4 for ambiguous features.

### Phase 2: Alternatives Exploration (Brainstorming Core)

**Always propose 2-3 approaches** with trade-offs for each.

Format:
```
### Approach A: {name} — Recommended
- Pros: ...
- Cons: ...
- Best for: ...

### Approach B: {name}
- Pros: ...
- Cons: ...
- Best for: ...

### Approach C: {name} (optional)
- Pros: ...
- Cons: ...
```

> Present the recommended approach first with clear reasoning.
> Then call `AskUserQuestion` tool with header "Approach", 2-3 options matching the approaches above,
> and `multiSelect: false`. Do NOT output the choices as text — use the tool.

### Phase 3: YAGNI Review (Brainstorming Core)

Perform a YAGNI (You Ain't Gonna Need It) review on the selected approach:

Call `AskUserQuestion` tool with:
- `question`: "첫 번째 버전에 반드시 필요한 항목만 선택하세요:" (adapt to user's language)
- `header`: "YAGNI review"
- `options`: List the 2-4 most important feature groups from the selected approach
- `multiSelect`: true

Move unselected items to Out of Scope in the plan document.

**Principle**: Don't abstract what can be done in 3 lines.
Don't design for hypothetical future requirements.

### Phase 4: Incremental Design Validation (Brainstorming Style)

Present the design section by section, getting approval after each:

1. Architecture overview → "Does this direction look right?"
2. Key components/modules → "Does this structure look right?"
3. Data flow → "Does this flow look right?"

> If the user says "no" to any section, revise only that section and re-present.

### Phase 5: Plan Document Generation

IMPORTANT: Use the Write tool to **directly write** the plan document file.
Do NOT use EnterPlanMode. PDCA plan phase ≠ OpenCode plan mode.

Generate the Plan document based on `plan-plus.template.md` (included in this skill's
directory as `<skill_files>`) with results from Phases 0-4, referencing the research results from `docs/00-research/{feature}-plan-research.md`.

**Write with evaluation criteria in mind** — the document will be scored against this checklist:
- RF (20pts): Research document referenced + findings applied to decisions
- DU (25pts): Domain glossary, principles, existing solutions compared
- PD (20pts): Problem/value stated, scope boundaries, target users
- SC (15pts): Functional requirements, acceptance criteria, MVP scope
- RA (10pts): Technical risks + mitigation strategies
- TD (10pts): Tech stack compared with rationale + references cited
Ensure every section has concrete evidence, not vague statements. Threshold: 80/100.

**Additional sections** (not in standard plan.template.md):
- **User Intent Discovery** — Core problem, target users, success criteria from Phase 1
- **Alternatives Explored** — Approaches compared in Phase 2
- **YAGNI Review** — Included/deferred/removed items from Phase 3
- **Brainstorming Log** — Key decisions from Phases 1-4

**Output Path**: `docs/01-plan/features/{feature}.plan.md`
**Action**: Use Write tool to create this file. Never enter plan mode for this.

After document generation, update PDCA status:
- Create Task: `[Plan Plus] {feature}`
- Update docs/.bkit-memory.json: phase = "plan"

### Phase 6: Next Steps

After Plan document generation:
```
Plan Plus completed
Document: docs/01-plan/features/{feature}.plan.md
Next step: /pdca design {feature}
```

## Key Principles

| Principle | Origin | Application |
|-----------|--------|-------------|
| One question at a time | Brainstorming | Sequential questions via AskUserQuestion |
| Explore alternatives | Brainstorming | Mandatory 2-3 approaches in Phase 2 |
| YAGNI ruthlessly | Brainstorming | multiSelect verification in Phase 3 |
| Incremental validation | Brainstorming | Section-by-section approval in Phase 4 |
| HARD-GATE | Brainstorming | No code before approval (entire process) |
| Research first | PDCA | Domain research before brainstorming in Phase 0 |
| Context first | Brainstorming | Automatic exploration in Phase 0 |

## Template Reference

The `plan-plus.template.md` template is included in this skill directory and will be
available as `<skill_files>` when this skill is invoked. Use its structure to generate
the Plan document in Phase 5.

| Section | Purpose |
|---------|---------|
| User Intent Discovery | Phase 1 results (core problem, users, criteria) |
| Alternatives Explored | Phase 2 comparison and selection |
| YAGNI Review | Phase 3 included/deferred/removed |
| Scope | Derived from YAGNI Review |
| Requirements | Functional and non-functional |
| Architecture Considerations | Key decisions, component overview, data flow |
| Brainstorming Log | Phase 1-4 decision history |

## Integration with PDCA

Plan Plus produces the same output as `/pdca plan` and feeds seamlessly into the
standard PDCA cycle:

```
/plan-plus {feature}     ← Enhanced planning with brainstorming
    ↓
/pdca design {feature}   ← Standard PDCA continues
    ↓
/pdca do {feature}
    ↓
/pdca analyze {feature}
    ↓
/pdca report {feature}
```

## Usage Examples

```bash
# Start brainstorming-enhanced planning
/plan-plus user-authentication

# After Plan Plus completes, continue with standard PDCA
/pdca design user-authentication
/pdca do user-authentication
```
