import type { PluginInput } from "@opencode-ai/plugin"
import { getPdcaStatus, formatPdcaStatus } from "../lib/pdca/status"
import { detectLevel, autoDetectLevel } from "../lib/pdca/level"
import { readAgentState } from "../lib/team/state-writer"
import { formatActivityDashboard } from "../lib/team/activity-log"
import { cache } from "../lib/core/cache"
import { debugLog } from "../lib/core/debug"
import { getHierarchicalConfig } from "../lib/context-hierarchy"
import { getActiveContext } from "../lib/task/context"

export function createSystemPromptHandler(input: PluginInput) {
  return async (
    sysInput: { sessionID?: string; model: any },
    output: { system: string[] },
  ) => {
    try {
      // Cache system prompt for 30 seconds
      const cached = cache.get<string>("bkit-system-prompt")
      if (cached) {
        output.system.push(cached)
        return
      }

      const pdcaStatus = await getPdcaStatus(input.directory)
      const level = detectLevel(input.directory)
      const teamState = readAgentState(input.directory)

      const primaryFeature = pdcaStatus.primaryFeature
      const featureData = primaryFeature ? pdcaStatus.features?.[primaryFeature] : null

      // Load hierarchical config overrides (project-level bkit.config.json etc.)
      const maxIterations = getHierarchicalConfig("pdca.maxIterations", 5)
      const matchThreshold = getHierarchicalConfig("pdca.matchThreshold", 90)
      const activeCtx = getActiveContext()

      const suggestedLevel = level ? null : autoDetectLevel(input.directory)

      const levelSection = level
        ? `## Project Level: ${level}`
        : `## Project Level: NOT SET

**MANDATORY**: The project level has not been set yet.
You MUST use AskUserQuestion to ask the user to choose their project level BEFORE doing any other work.
Auto-detected suggestion based on project structure: **${suggestedLevel}**

Ask with these options:
- **Starter**: Static websites, portfolios, landing pages (HTML/CSS/JS)
- **Dynamic**: Fullstack apps with auth, database, API (BaaS/backend)
- **Enterprise**: Microservices, Kubernetes, Terraform, CI/CD

After the user selects, store it by calling bkit-level-info tool with action="set" and level="{chosen}".
Do NOT proceed with any task until the project level is set.`

      // M-3: Trimmed system prompt — removed Agent Auto-Triggers table (handled by
      // chat.message hook) and verbose Response Footer rules (UX-only, not core logic).
      // Kept: PDCA Status, Rules, Tools, Agent list, Delegation guide, Write Permissions.
      const prompt = `# bkit Vibecoding Kit v1.0.0 (OpenCode Edition)

${levelSection}
${maxIterations !== 5 || matchThreshold !== 90 ? `\n## Custom Config\n- Max Iterations: ${maxIterations}\n- Match Threshold: ${matchThreshold}%` : ""}

## PDCA Status
${formatPdcaStatus(pdcaStatus)}
${activeCtx.skill || activeCtx.agent ? `\n## Active Context\n${activeCtx.skill ? `- Active Skill: ${activeCtx.skill}` : ""}${activeCtx.agent ? `\n- Active Agent: ${activeCtx.agent}` : ""}` : ""}

## Tools & Agent Delegation
| Tool | Description |
|------|-------------|
| bkit-pdca-status | PDCA status, phase recording (action=update), sync, and next phase guidance |
| bkit-level-info | Project level info and guidance |
| bkit-agent-mailbox | Inter-agent messaging (send/receive/list) |
| bkit-agent-monitor | Real-time agent status, mailbox, completions |
| agent | Spawn agent (sync or background). abort_session_id to redirect |
| agent_result | Check background task status/output (job_id or list_all=true) |
| bkit-task-board | Task board for CTO-Lead: list/create/update/complete tasks |

Use \`agent\` to delegate work to agents. Background mode recommended for tasks > 5min.
Use \`bkit-agent-monitor\` for real-time overview of all running agents.
Use \`bkit-agent-mailbox\` to send directives to agents between turns.
For long-running tasks (10+ tool calls), periodically call bkit-agent-mailbox(action="receive") to check for leader directives.

## Team Status
${teamState?.enabled
  ? `Active team: "${teamState.feature}" | Phase: ${teamState.pdcaPhase} | Pattern: ${teamState.orchestrationPattern} | Teammates: ${teamState.teammates.length}`
  : "No active team."}
${formatActivityDashboard(input.directory)}

## PDCA Rules
IMPORTANT: PDCA "plan phase" means WRITING a plan document to docs/01-plan/.
Do NOT confuse this with OpenCode's "plan mode" (EnterPlanMode).
When PDCA skill says "plan", directly CREATE the document file — do NOT enter plan mode.

- New feature → research (docs/00-research/) → docs/01-plan/ → research → docs/02-design/ → implement → gap-detector → iterate if <90% → report
- During plan/check phases, source code writes are restricted. docs/** and state files are always allowed.

## CRITICAL: Phase Recording
You MUST call bkit-pdca-status(action="update", feature="{name}", phase="{phase}") at the START of each PDCA phase.
This is the PRIMARY mechanism for recording progress. File-write detection is a secondary backup only.
Example: bkit-pdca-status(action="update", feature="user-auth", phase="plan")

## Document Evaluation Flow
After creating a plan or design document, spawn an evaluation sub-task (sync, sonnet) to evaluate quality:
- Evaluator runs in a separate session (fresh context, no self-evaluation bias)
- Score >= 80: PASS — proceed to next phase
- Score < 80: revision recommended — review the pre-existing research in docs/00-research/ and revise the document to address gaps
- If evaluation fails (timeout, parse error): assume PASS — evaluation is advisory, not a blocker

## Available Agents
| Agent | Role | Phase |
|-------|------|-------|
| cto-lead | Multi-agent orchestration | All |
| product-manager | Requirements, PRD | Plan |
| design-validator | Spec consistency | Design |
| frontend-architect | UI/UX, components | Design, Do |
| security-architect | OWASP, auth review | Design, Check |
| enterprise-expert | Microservices arch | Design |
| infra-architect | AWS, K8s, Terraform | Design, Do |
| backend-expert | Backend all langs | Design, Do, Act |
| baas-expert | bkend.ai BaaS | Design, Do, Check, Act |
| gap-detector | Design vs impl check | Check |
| code-analyzer | Quality, security scan | Check |
| qa-strategist | Test strategy | Check |
| qa-monitor | Docker log QA | Check |
| pdca-iterator | Auto-improvement | Act |
| report-generator | Completion report | Report |
| pipeline-guide | Dev pipeline nav | Any |
| starter-guide | Beginner help | Any |

## Internal-Only Skills
The following skills are internal (invoked via PDCA flow, not directly by users):
phase-1~9, bkend-auth/data/storage/cookbook/quickstart, zero-script-qa, bkit-rules, bkit-templates

## Response Footer (MANDATORY — every response)
You MUST end EVERY response with this block. A response without it is incomplete.
Report which bkit features (PDCA skills, agents, tools) were used, why major ones were skipped, and what to do next based on current PDCA phase.
\`\`\`
─────────────────────────────────────────────────
📊 bkit Feature Usage
─────────────────────────────────────────────────
✅ Used: [bkit features actually used in this response]
⏭️ Not Used: [major unused features] (brief reason)
💡 Recommended: [next action based on PDCA phase]
─────────────────────────────────────────────────
\`\`\`

## Next Step
${featureData
  ? featureData.phase === "plan" ? `Design with /pdca design ${primaryFeature}`
    : featureData.phase === "design" ? `Start implementation or /pdca do ${primaryFeature}`
    : featureData.phase === "do" ? `Gap analysis with /pdca analyze ${primaryFeature}`
    : featureData.phase === "check" && (featureData.matchRate ?? 0) < 90 ? `Auto-improve with /pdca iterate ${primaryFeature}`
    : featureData.phase === "check" ? `Completion report with /pdca report ${primaryFeature}`
    : featureData.phase === "act" ? `Re-check with /pdca analyze ${primaryFeature}`
    : `Start next feature with /pdca plan`
  : "Start with /pdca plan {feature}"}
`

      cache.set("bkit-system-prompt", prompt, 30_000)
      output.system.push(prompt)
      debugLog("SystemPrompt", "Injected bkit context", { level, feature: primaryFeature })
    } catch (e: any) {
      debugLog("SystemPrompt", "Handler error (non-fatal)", { error: e.message })
    }
  }
}
