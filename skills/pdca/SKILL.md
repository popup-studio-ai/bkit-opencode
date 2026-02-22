---
name: pdca
description: |
  Unified skill for managing the entire PDCA cycle.
  Auto-triggered by keywords: "research", "plan", "design", "analyze", "report", "status".
  Replaces legacy /pdca-* commands.

  Use proactively when user mentions PDCA cycle, planning, design documents,
  gap analysis, iteration, or completion reports.

  Triggers: pdca, 계획, 설계, 분석, 검증, 보고서, 반복, 개선, plan, design, analyze,
  check, report, status, next, iterate, gap, 計画, 設計, 分析, 検証, 報告,
  计划, 设计, 分析, 验证, 报告, planificar, diseño, analizar, verificar,
  planifier, conception, analyser, vérifier, rapport,
  planen, Entwurf, analysieren, überprüfen, Bericht,
  pianificare, progettazione, analizzare, verificare, rapporto

  Do NOT use for: simple queries without PDCA context, code-only tasks.
---

# PDCA Skill

> Unified Skill for managing PDCA cycle. Supports the entire Research → Plan → Design → Do → Check → Act flow.

## Current Invocation

**Action:** `$1`
**Feature:** `$2`
**Raw Arguments:** $ARGUMENTS

Parse the action and feature above, then follow the matching action section below.
If feature is empty, use the primary feature from PDCA status.

## Arguments

| Argument | Description | Example |
|----------|-------------|---------|
| `plan [feature]` | Create Plan document | `/pdca plan user-auth` |
| `design [feature]` | Create Design document (includes user journey flows) | `/pdca design user-auth` |
| `do [feature]` | Do phase guide (start implementation) | `/pdca do user-auth` |
| `analyze [feature]` | Run Gap analysis (Check phase) | `/pdca analyze user-auth` |
| `iterate [feature]` | Auto improvement iteration (Act phase) | `/pdca iterate user-auth` |
| `report [feature]` | Generate completion report | `/pdca report user-auth` |
| `archive [feature]` | Archive completed PDCA documents | `/pdca archive user-auth` |
| `cleanup [feature]` | Cleanup archived features from status | `/pdca cleanup` |
| `team [feature]` | Start PDCA Team Mode (requires Agent Teams) | `/pdca team user-auth` |
| `team status` | Show Team status | `/pdca team status` |
| `team cleanup` | Cleanup Team resources | `/pdca team cleanup` |
| `status` | Show current PDCA status | `/pdca status` |
| `next` | Guide to next phase | `/pdca next` |

## Phase Prerequisite Rule (CRITICAL — applies to ALL actions)

Before executing ANY action, check all prior phases and redirect to the earliest incomplete one.

**Phase chain**: research → plan → design → do → check → act

**Document existence check (in order)**:

| Phase | Required Document | Created By |
|-------|------------------|------------|
| research | `docs/00-research/{feature}-plan-research.md` | plan action (step 3) or `/plan-plus` (Phase 0) |
| plan | `docs/01-plan/features/{feature}.plan.md` | plan action (step 5) or `/plan-plus` (Phase 5) |
| design | `docs/02-design/features/{feature}.design.md` | design action (step 4) |
| do | Source files exist in `src/` | do action |
| check | `docs/03-analysis/{feature}.analysis.md` | analyze action |

**Redirect logic**:
1. When action X is requested, check each prior phase document (earliest first)
2. If a prior phase document is missing → execute that phase action instead
3. Inform user: "⚠️ {requested action} requires {missing phase} first. Running {missing phase}."
4. After the prerequisite completes, suggest the originally requested action

**Examples**:
- `/pdca design` but no plan doc → run plan action (which includes research)
- `/pdca do` but no design doc → run design action
- `/pdca do` but no plan doc either → run plan action (earliest missing)
- `/pdca analyze` but no implementation → run do action

---

## Phase Status Recording (MANDATORY — every phase)

**CRITICAL**: At the START of every PDCA phase action, you MUST call the status update tool:

```
bkit-pdca-status(action="update", feature="{feature}", phase="{phase}")
```

This is the PRIMARY mechanism for recording PDCA progress in OpenCode.
File-write detection (tool-after hooks) is a secondary backup only.

**Why this matters**: OpenCode skills don't trigger `tool.execute.after` hooks like Claude Code does.
Without this explicit call, `.pdca-status.json` will NOT be updated.

**Phase values**: research, plan, design, do, check, act, completed

---

## Action Details

### plan (Plan Phase)

IMPORTANT: "plan" here means WRITING a plan document file. Do NOT use EnterPlanMode.
Directly create/write the file using the Write tool. PDCA plan phase ≠ OpenCode plan mode.

0. **Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="plan")`
1. Check if `docs/01-plan/features/{feature}.plan.md` exists
2. **Backend approach check** (Dynamic level only): If the feature involves backend/data/auth and no backend approach is recorded in `.bkit-memory.json`, ask using AskUserQuestion:
   - question: "How would you like to handle the backend?"
   - header: "Backend"
   - options: "BaaS (bkend.ai)" (recommended) / "Custom backend" / "Other BaaS"
   - Save choice to `.bkit-memory.json` as `backendApproach` (only asked once per project)
3. **Research first**: Use WebSearch and/or Explore agent. The research document MUST cover:
   - **Domain Glossary**: Key domain terms and definitions (→ feeds DU-01 evaluation)
   - **Domain Principles**: Core theories, rules, or conventions of the domain (→ feeds DU-02)
   - **Existing Solutions**: Compare 2-3 existing products/approaches with pros/cons table (→ feeds DU-03)
   - **Tech Stack Candidates**: Compare relevant tech options with rationale (→ feeds TD-01, TD-02)
   - **Sources**: All URLs and references cited (→ feeds RF-01)
4. Save research results to `docs/00-research/{feature}-plan-research.md`
5. If plan doc does not exist, **directly write** the file using Write tool based on `plan.template.md`, referencing the research results and backend approach. Explicitly cite research findings (e.g., "Based on research [RF], ...")
6. **Write with evaluation criteria in mind** — the document will be scored against this checklist:
   - RF (20pts): Research document referenced + findings applied to decisions
   - DU (25pts): Domain glossary, principles, existing solutions compared
   - PD (20pts): Problem/value stated, scope boundaries, target users
   - SC (15pts): Functional requirements, acceptance criteria, MVP scope
   - RA (10pts): Technical risks + mitigation strategies
   - TD (10pts): Tech stack compared with rationale + references cited
   Ensure every section has concrete evidence, not vague statements. Threshold: 80/100.
7. If exists, display content and suggest modifications
8. **Self-Evaluation (MANDATORY)**: After writing the plan document, you MUST evaluate it yourself:
   - Re-read the completed document
   - Score each criterion (RF, DU, PD, SC, RA, TD) using the checklist in step 6
   - Calculate total score out of 100
   - If score < 80: revise the document to address gaps, then re-evaluate
   - If score >= 80: proceed
   - Display the result to the user:
     ```
     📋 Plan Self-Evaluation: {score}/100 {PASS|FAIL}
     RF: {n}/20 | DU: {n}/25 | PD: {n}/20 | SC: {n}/15 | RA: {n}/10 | TD: {n}/10
     ```
9. Create Task: `[Plan] {feature}`
10. Update docs/.bkit-memory.json: phase = "plan"

**Output Path**: `docs/01-plan/features/{feature}.plan.md`
**Research Path**: `docs/00-research/{feature}-plan-research.md`
**Action**: Use Write tool to create these files. Never enter plan mode for this.

### design (Design Phase)

0. **Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="design")`
1. **Prerequisite check**: Verify `docs/01-plan/features/{feature}.plan.md` exists. If missing, run plan action instead (see Phase Prerequisite Rule above)
2. **Research first**: Use WebSearch and/or Explore agent. The research document MUST cover:
   - **Architecture Patterns**: Compare 2-3 architecture approaches with trade-offs (→ feeds AC-01, AC-02)
   - **Library Comparison**: Candidate libraries with versions, bundle size, maintenance status (→ feeds TS-01)
   - **Performance/Cost Data**: Benchmarks, pricing tiers, or resource usage comparisons (→ feeds TS-02)
   - **Implementation Examples**: Code snippets or patterns from official docs or proven projects (→ feeds RF-02)
   - **Sources**: All URLs and references cited (→ feeds RF-01)
3. Save research results to `docs/00-research/{feature}-design-research.md`
4. **Directly write** `docs/02-design/features/{feature}.design.md` using Write tool
4.5. **Journey depth decision**: Use AskUserQuestion
   - question: "사용자 여정(User Journey)을 어떻게 작성할까요? / How should the User Journey be documented?"
   - header: "Journey"
   - options:
     - "Simple" — Design 문서 Section 5.2에 포함 (Include in Design doc Section 5.2, 1-2 pages)
     - "Detailed" — 별도 journey 문서 작성 (Separate journey doc at docs/02-design/journey/{feature}.journey.md)
   - multiSelect: false
4.6. If Simple:
   - Design 문서의 Section 5.2 "User Journey"에 사용자 흐름, 시나리오, 화면 전환 포함
   - Include user flows, key scenarios, and screen transitions inline in the design document
4.7. If Detailed:
   - Use `journey.template.md` to create `docs/02-design/journey/{feature}.journey.md`
   - Add reference link in Design document Section 5.2:
     > 상세 사용자 여정: [journey/{feature}.journey.md](journey/{feature}.journey.md)
5. Use `design.template.md` structure + reference Plan content + research results. Explicitly cite research findings (e.g., "Based on research [RF], ...")
6. **Write with evaluation criteria in mind** — the document will be scored against this checklist:
   - RF (15pts): Research document referenced + design decisions backed by research evidence
   - DS (20pts): Core types/interfaces defined, field docs, relationships mapped
   - AC (25pts): Architecture diagram, module scope, error handling strategy
   - DF (15pts): Step-by-step flow documented, I/O formats specified
   - AI (15pts): Function/API signatures listed, call relationships mapped
   - TS (10pts): Library versions with rationale, cost/performance analysis, build config
   Ensure every design decision cites research or prior art. Threshold: 80/100.
7. **Self-Evaluation (MANDATORY)**: After writing the design document, you MUST evaluate it yourself:

   **Part A — Design Checklist (100pts, threshold 80):**
   - Re-read the completed document
   - Score each criterion (RF, DS, AC, DF, AI, TS) using the checklist in step 6
   - If score < 80: revise and re-evaluate

   **Part B — UI/UX Quality Rubric (10pts, threshold 6):**
   - Screen Wireframes (3pts): 3+ screens = 3, 1-2 = 2, text only = 1, none = 0
   - Component State Matrix (2pts): 5+ components with all states = 2, partial = 1, none = 0
   - Screen Transition Diagram (2pts): complete map = 2, partial = 1, none = 0
   - Responsive Layout (1pt): mobile/desktop differences described = 1
   - Design Token Reference (1pt): components use tokens not hardcoded values = 1
   - Error/Empty/Loading States (1pt): all interactive components covered = 1

   **Display the result to the user:**
   ```
   📋 Design Self-Evaluation
   ─────────────────────────────────────
   Design Score: {score}/100 {PASS|FAIL}
   RF: {n}/15 | DS: {n}/20 | AC: {n}/25 | DF: {n}/15 | AI: {n}/15 | TS: {n}/10

   UI/UX Score: {score}/10 {PASS|FAIL}
   Wireframes: {n}/3 | States: {n}/2 | Transitions: {n}/2 | Responsive: {n}/1 | Tokens: {n}/1 | Error/Empty: {n}/1
   ─────────────────────────────────────
   ```

   **Gate rules:**
   - Design < 80/100 → revise document before proceeding
   - UI/UX < 6/10 → add missing wireframes, state matrix, or transition diagram before proceeding
   - Both passed → proceed to next phase

8. Create Task: `[Design] {feature}` (blockedBy: Plan task)
9. Update docs/.bkit-memory.json: phase = "design"

**Output Path**: `docs/02-design/features/{feature}.design.md`
**Journey Path (Detailed only)**: `docs/02-design/journey/{feature}.journey.md`
**Research Path**: `docs/00-research/{feature}-design-research.md`
**Action**: Use Write tool to create these files. Never enter plan mode for this.

### do (Do Phase)

0. **Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="do")`
1. **Prerequisite check**: Verify `docs/02-design/features/{feature}.design.md` exists. If missing, check plan doc too — run the earliest missing phase action (see Phase Prerequisite Rule above)
2. Provide implementation guide based on `do.template.md`
3. Reference implementation order from Design document
4. **Write skeleton code** — Create all files with function signatures, parameters, return types, and TODO placeholders (no implementation bodies yet)
5. **Skeleton Journey Verification** — Trace the User Journey (from Design doc Section 5.2 or journey/{feature}.journey.md) through the skeleton code:
   - For each journey step, identify the function call chain (entry point → service → data layer)
   - Verify function names, parameter types, and return types are consistent across the chain
   - Check that all journey scenarios (happy path, error cases) have corresponding skeleton functions
   - If gaps found: add missing skeleton functions before proceeding
   - Output: checklist of journey steps mapped to skeleton functions with pass/fail status
6. **Write detailed implementation** — Fill in function bodies following the verified skeleton structure
7. Create Task: `[Do] {feature}` (blockedBy: Design task)
8. Update docs/.bkit-memory.json: phase = "do"

**Guide Provided**:
- Implementation order checklist
- Key files/components list
- Dependency installation commands
- Skeleton → Verify → Implement workflow

### analyze (Check Phase)

0. **Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="check")`
1. **Prerequisite check**: Verify implementation source code exists. If missing, check design/plan docs too — run the earliest missing phase action (see Phase Prerequisite Rule above)
2. **Call gap-detector Agent**
3. Compare Design document vs implementation code
4. Calculate Match Rate and generate Gap list
5. Create Task: `[Check] {feature}` (blockedBy: Do task)
6. Update docs/.bkit-memory.json: phase = "check", matchRate

**Output Path**: `docs/03-analysis/{feature}.analysis.md`

### iterate (Act Phase)

0. **Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="act")`
1. **Prerequisite check**: Verify `docs/03-analysis/{feature}.analysis.md` exists with matchRate < 90%. If analysis missing, run analyze action first (see Phase Prerequisite Rule above)
2. **Call pdca-iterator Agent**
3. Auto-fix code based on Gap list
4. Auto re-run Check after fixes
5. Create Task: `[Act-N] {feature}` (N = iteration count)
6. Stop when >= 90% reached or max iterations (5) hit

**Iteration Rules**:
- Max iterations: 5 (adjustable via bkit.config.json)
- Stop conditions: matchRate >= 90% or maxIterations reached

### report (Completion Report)

0. **Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="completed")`
1. **Prerequisite check**: Verify analysis exists with matchRate >= 90%. If matchRate < 90%, run iterate action first. If analysis missing, run analyze first (see Phase Prerequisite Rule above)
2. **Call report-generator Agent**
3. Integrated report of Plan, Design, Implementation, Analysis
4. Create Task: `[Report] {feature}`
5. Update docs/.bkit-memory.json: phase = "completed"

**Output Path**: `docs/04-report/{feature}.report.md`

### team (Team Mode) - v1.5.1

Start PDCA Team Mode using Agent Teams (always available in OpenCode via Task tool).

#### team [feature] - Start Team Mode

1. Check if Agent Teams is available: call `isTeamModeAvailable()` from `lib/team/coordinator.ts` (always true in OpenCode)
3. Detect project level via `detectLevel()` - Starter projects cannot use Team Mode
4. Generate team strategy via `generateTeamStrategy(level)`:
   - Dynamic: ~3 agents recommended (CTO selects from role catalog by feature keywords) — CTO Lead orchestrates
   - Enterprise: ~5 agents recommended (CTO selects from role catalog by feature keywords) — CTO Lead orchestrates
5. CTO Lead (cto-lead agent, opus) automatically:
   - Sets technical direction and selects orchestration pattern
   - Distributes tasks to teammates based on PDCA phase
   - Enforces quality gates (90% Match Rate threshold)
6. Show strategy and confirm with AskUserQuestion before starting
7. Assign PDCA tasks to teammates via `assignNextTeammateWork()`

#### team status - Show Team Status

1. Call `formatTeamStatus()` from `lib/team/coordinator.js`
2. Display: Team availability, enabled state, display mode, teammate count
3. Show current PDCA feature progress per teammate if active

**Output Example**:
```
📊 PDCA Team Status
─────────────────────────────
Agent Teams: Available ✅
Display Mode: in-process
Teammates: 4 / 4 (Enterprise)
─────────────────────────────
Feature: user-auth
  architect: [Design] in progress
  developer: [Do] waiting
  qa: idle
  reviewer: idle
```

#### team cleanup - Cleanup Team Resources

1. Stop all active teammates
2. Record `team_session_ended` in PDCA history via `addPdcaHistory()`
3. Return to single-session PDCA mode
4. Display: "Returning to single-session mode"

**Required**: OpenCode (Agent Teams always available via Task tool)

**Level Requirements**:
| Level | Available | Recommended Max | CTO Lead |
|-------|:---------:|:---------------:|:--------:|
| Starter | No | - | - |
| Dynamic | Yes | ~3 (CTO may add more) | cto-lead (opus) |
| Enterprise | Yes | ~5 (CTO may add more) | cto-lead (opus) |

### archive (Archive Phase)

1. Verify Report completion status (phase = "completed" or matchRate >= 90%)
2. Verify PDCA documents exist (plan, design, analysis, report)
3. Create `docs/archive/YYYY-MM/{feature}/` folder
4. Move documents (delete from original location)
5. Update Archive Index (`docs/archive/YYYY-MM/_INDEX.md`)
6. **Record phase**: `bkit-pdca-status(action="update", feature="{feature}", phase="archived")` — auto-commits all doc moves
7. Remove feature from status (or preserve summary with `--summary` option)

**Arguments**:
| Argument | Description | Example |
|----------|-------------|---------|
| `archive {feature}` | Archive with complete cleanup (default) | `/pdca archive user-auth` |
| `archive {feature} --summary` | Archive with summary preservation (FR-04) | `/pdca archive user-auth --summary` |

**Output Path**: `docs/archive/YYYY-MM/{feature}/`

**Documents to Archive**:
- `docs/00-research/{feature}-plan-research.md` (if exists)
- `docs/00-research/{feature}-design-research.md` (if exists)
- `docs/01-plan/features/{feature}.plan.md`
- `docs/02-design/features/{feature}.design.md`
- `docs/02-design/journey/{feature}.journey.md` (if exists, Detailed mode only)
- `docs/03-analysis/{feature}.analysis.md`
- `docs/04-report/features/{feature}.report.md`

**FR-04: Summary Preservation Option** (v1.4.8):

When using `--summary` (or `--preserve-summary`, `-s`), the feature data in `docs/.pdca-status.json`
is converted to a lightweight summary instead of being deleted:

```json
// Summary format (70% size reduction)
{
  "my-feature": {
    "phase": "archived",
    "matchRate": 100,
    "iterationCount": 2,
    "startedAt": "2026-01-15T10:00:00Z",
    "archivedAt": "2026-01-20T15:30:00Z",
    "archivedTo": "docs/archive/2026-01/my-feature/"
  }
}
```

Use `--summary` when you need:
- Historical statistics and metrics
- Project duration tracking
- PDCA efficiency analysis

**Important Notes**:
- Cannot archive before Report completion
- Documents are deleted from original location after move (irreversible)
- Feature name must match exactly
- Default behavior: complete deletion from status
- Use `--summary` to preserve metrics for future reference

### cleanup (Cleanup Phase) - v1.4.8

Clean up archived features from `docs/.pdca-status.json` to reduce file size.

1. Read archived features from `docs/.pdca-status.json`
2. Display list with timestamps and archive paths
3. Ask user for confirmation via AskUserQuestion (FR-06)
4. Delete selected features from status using `cleanupArchivedFeatures()`
5. Report cleanup results

**Arguments**:
| Argument | Description | Example |
|----------|-------------|---------|
| `cleanup` | Interactive cleanup (shows list) | `/pdca cleanup` |
| `cleanup all` | Delete all archived features | `/pdca cleanup all` |
| `cleanup {feature}` | Delete specific feature | `/pdca cleanup old-feature` |

**Output Example**:
```
🧹 PDCA Cleanup
─────────────────────────────
Archived features found: 3

1. feature-a (archived: 2026-01-15)
2. feature-b (archived: 2026-01-20)
3. feature-c (archived: 2026-01-25)

Select features to cleanup:
[ ] All archived features
[ ] Select specific features
[ ] Cancel
```

**Related Functions** (`lib/pdca/status.js`):
- `getArchivedFeatures()` - Get list of archived features
- `cleanupArchivedFeatures(features?)` - Cleanup specific or all archived
- `deleteFeatureFromStatus(feature)` - Delete single feature
- `enforceFeatureLimit(max=50)` - Auto cleanup when limit exceeded

**Notes**:
- Only archived/completed features can be deleted
- Active features are protected from deletion
- Archive documents remain in `docs/archive/` (only status is cleaned)

### status (Status Check)

1. Call `bkit-pdca-status(action="status")` — this auto-syncs from docs and returns current status
2. Display current feature, PDCA phase, Task status
3. Visualize progress

**Output Example**:
```
📊 PDCA Status
─────────────────────────────
Feature: user-authentication
Phase: Check (Gap Analysis)
Match Rate: 85%
Iteration: 2/5
─────────────────────────────
[Research] ✅ → [Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] 🔄 → [Act] ⏳
```

### next (Next Phase)

1. Check current PDCA phase
2. Suggest next phase guide and commands
3. Confirm with user via AskUserQuestion

**Phase Guide**:
| Current | Next | Suggestion |
|---------|------|------------|
| None | research | Start research: `/pdca plan [feature]` or `/plan-plus [feature]` (research is auto-included) |
| research | plan | `/pdca plan [feature]` or `/plan-plus [feature]` |
| plan | design | `/pdca design [feature]` |
| design | do | Implementation start guide |
| do | check | `/pdca analyze [feature]` |
| check (<90%) | act | `/pdca iterate [feature]` |
| check (>=90%) | report | `/pdca report [feature]` |
| report | archive | `/pdca archive [feature]` |

## Template References

Templates loaded from imports are used when executing each action:

| Action | Template | Purpose |
|--------|----------|---------|
| plan | `plan.template.md` | Plan document structure |
| design | `design.template.md` | Design document structure |
| design (journey) | `journey.template.md` | Detailed journey document (when Detailed mode selected) |
| do | `do.template.md` | Implementation guide structure |
| analyze | `analysis.template.md` | Analysis report structure |
| report | `report.template.md` | Completion report structure |

## Task Integration

Each PDCA phase automatically integrates with Task System:

```
Task Creation Pattern:
┌────────────────────────────────────────┐
│ [Research] {feature}                   │
│   ↓ (blockedBy)                        │
│ [Plan] {feature}                       │
│   ↓ (blockedBy)                        │
│ [Design] {feature}                     │
│   ↓ (blockedBy)                        │
│ [Do] {feature}                         │
│   ↓ (blockedBy)                        │
│ [Check] {feature}                      │
│   ↓ (blockedBy, Check < 90%)           │
│ [Act-1] {feature}                      │
│   ↓ (on iteration)                     │
│ [Act-N] {feature}                      │
│   ↓ (Check >= 90%)                     │
│ [Report] {feature}                     │
│   ↓ (after Report completion)          │
│ [Archive] {feature}                    │
└────────────────────────────────────────┘
```

## Agent Integration

| Action | Agent | Role |
|--------|-------|------|
| analyze | gap-detector | Compare Design vs Implementation |
| iterate | pdca-iterator | Auto code fix and re-verification |
| report | report-generator | Generate completion report |

## Usage Examples

```bash
# Start new feature (research is auto-included in plan)
/pdca plan user-authentication

# Create design document (includes user journey flows, research auto-included)
/pdca design user-authentication

# Implementation guide
/pdca do user-authentication

# Gap analysis after implementation
/pdca analyze user-authentication

# Auto improvement (if needed)
/pdca iterate user-authentication

# Completion report
/pdca report user-authentication

# Check current status
/pdca status

# Guide to next phase
/pdca next
```

## Legacy Commands Mapping

| Legacy Command | PDCA Skill |
|----------------|------------|
| `/pdca-plan` | `/pdca plan` |
| `/pdca-design` | `/pdca design` |
| `/pdca-analyze` | `/pdca analyze` |
| `/pdca-iterate` | `/pdca iterate` |
| `/pdca-report` | `/pdca report` |
| `/pdca-status` | `/pdca status` |
| `/pdca-next` | `/pdca next` |
| `/archive` | `/pdca archive` |

## Output Style Integration (v1.5.1)

PDCA workflows benefit from the `bkit-pdca-guide` output style:

```
/output-style bkit-pdca-guide
```

This provides PDCA-specific response formatting:
- Phase status badges: `[Research] -> [Plan] -> [Design] -> [Do] -> [Check] -> [Act]`
- Gap analysis suggestions after code changes
- Next-phase guidance with checklists
- Feature usage report integration

When running PDCA commands, suggest this style if not already active.

## Agent Teams Integration (v1.5.1)

For Dynamic/Enterprise projects, PDCA phases can run in parallel using Agent Teams:

```
/pdca team {feature}        Start parallel PDCA
/pdca team status            Monitor teammate progress
/pdca team cleanup           End team session
```

Suggest Agent Teams when:
- Feature is classified as Major Feature (>= 1000 chars)
- Match Rate < 70% (parallel iteration can speed up fixes)
- Project level is Dynamic or Enterprise

CTO-Led Team Orchestration Patterns:
| Level | Research | Plan | Design | Do | Check | Act |
|-------|----------|------|--------|-----|-------|-----|
| Dynamic | leader | leader | leader | swarm | council | leader |
| Enterprise | leader | leader | council | swarm | council | watchdog |

## Auto Triggers

Auto-suggest related action when detecting these keywords:

| Keyword | Suggested Action |
|---------|------------------|
| "research", "investigate", "explore", "study" | research |
| "plan", "planning", "roadmap" | plan |
| "design", "architecture", "spec", "user flow", "user story" | design |
| "implement", "develop", "build" | do |
| "verify", "analyze", "check" | analyze |
| "improve", "iterate", "fix" | iterate |
| "complete", "report", "summary" | report |
| "archive", "store" | archive |
| "cleanup", "clean", "remove old" | cleanup |
