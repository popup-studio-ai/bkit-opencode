// Team Orchestration Engine
// Core engine for PDCA phase-based team orchestration.
// Ported from bkit-claude-code lib/team/orchestrator.js to TypeScript for OpenCode.
//
// KEY DIFFERENCE from the original:
// Instead of generating spawnTeam commands (Claude Code Agent Teams),
// this module generates Task Tool instructions for OpenCode.
// The LLM reads these instructions and calls Task tools to spawn sub-agents.

import { debugLog } from "../core/debug"
import { LEVEL_CONFIG, selectRolesForFeature, TEAM_STRATEGIES } from "./strategy"
import { createTeamTasks, type TeamTask } from "./task-queue"
import { createPhaseTransitionNotice, createDirective } from "./communication"
import { decidePdcaPhase, evaluateCheckResults, recommendTeamComposition } from "./cto-logic"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeammateComposition {
  name: string
  agentType: string
  agents: string[]
  task: string
  description: string
}

export interface TeamComposition {
  pattern: string
  teammates: TeammateComposition[]
  phaseStrategy: string
  ctoAgent: string | null
}

// ---------------------------------------------------------------------------
// Phase-to-Pattern Mapping
// ---------------------------------------------------------------------------

/**
 * PDCA phase-to-orchestration pattern mapping per level.
 * Read from bkit.config.json team.orchestrationPatterns when available,
 * falling back to these built-in defaults.
 */
export const PHASE_PATTERN_MAP: Record<string, Record<string, string>> = {
  Dynamic: {
    plan: "leader",
    design: "leader",
    do: "swarm",
    check: "council",
    act: "leader",
  },
  Enterprise: {
    plan: "leader",
    design: "council",
    do: "swarm",
    check: "council",
    act: "watchdog",
  },
}

// ---------------------------------------------------------------------------
// Task Description Generator
// ---------------------------------------------------------------------------

/**
 * Generate a detailed task description for a role in a specific PDCA phase.
 */
function generateTaskDescription(phase: string, roleName: string, feature: string): string {
  const descriptions: Record<string, Record<string, string>> = {
    plan: {
      developer: `Analyze implementation requirements for ${feature}`,
      frontend: `Analyze UI/UX requirements for ${feature}`,
      qa: `Define quality criteria and test strategy for ${feature}`,
      architect: `Analyze architecture requirements for ${feature}`,
      security: `Identify security requirements for ${feature}`,
      reviewer: `Review plan completeness for ${feature}`,
    },
    design: {
      developer: `Design backend API and data model for ${feature}`,
      frontend: `Design UI component architecture for ${feature}`,
      qa: `Design test strategy for ${feature}`,
      architect: `Design system architecture for ${feature}`,
      security: `Design security architecture for ${feature}`,
      reviewer: `Validate design completeness for ${feature}`,
    },
    do: {
      developer: `Implement backend code for ${feature} based on Design document`,
      frontend: `Implement UI components for ${feature} based on Design document`,
      qa: `Prepare verification environment for ${feature}`,
      architect: `Review implementation architecture for ${feature}`,
      security: `Implement security controls for ${feature}`,
      reviewer: `Code review during implementation of ${feature}`,
    },
    check: {
      developer: `Support verification for ${feature}`,
      frontend: `Verify UI implementation for ${feature}`,
      qa: `Execute gap analysis and quality verification for ${feature}`,
      architect: `Verify architecture compliance for ${feature}`,
      security: `Execute security audit (OWASP Top 10) for ${feature}`,
      reviewer: `Code review and design validation for ${feature}`,
    },
    act: {
      developer: `Fix implementation issues for ${feature}`,
      frontend: `Fix UI issues for ${feature}`,
      qa: `Monitor fixes and re-verify for ${feature}`,
      architect: `Review fix architecture impact for ${feature}`,
      security: `Verify security fixes for ${feature}`,
      reviewer: `Review fixes and validate for ${feature}`,
    },
  }

  return (
    descriptions[phase]?.[roleName] ??
    `Execute ${phase} phase work for ${feature} as ${roleName}`
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the orchestration pattern for a PDCA phase at a given level.
 *
 * Returns "single" for levels without a pattern map (e.g. Starter).
 */
export function selectOrchestrationPattern(phase: string, level: string): string {
  if (!PHASE_PATTERN_MAP[level]) return "single"
  return PHASE_PATTERN_MAP[level][phase] ?? "leader"
}

/**
 * Compose a team for a specific PDCA phase.
 *
 * Returns a TeamComposition with the selected pattern, a list of teammates
 * (filtered to those participating in the given phase), and the phase strategy.
 * Returns null if the level has no team strategy or no roles match the phase.
 */
export function composeTeamForPhase(
  phase: string,
  level: string,
  feature: string,
): TeamComposition | null {
  const config = LEVEL_CONFIG[level]
  if (!config) return null

  const pattern = selectOrchestrationPattern(phase, level)

  // Use dynamic role selection based on feature keywords
  const selected = selectRolesForFeature(feature, phase, level)

  if (selected.length === 0) return null

  const teammates: TeammateComposition[] = selected.map((s) => ({
    name: s.role.name,
    agentType: s.role.agents[0], // Primary agent for the role
    agents: s.role.agents,
    task: generateTaskDescription(phase, s.role.name, feature),
    description: s.role.description,
  }))

  debugLog("orchestrator", "Team composed", {
    phase,
    level,
    feature,
    pattern,
    teammateCount: teammates.length,
    roles: selected.map((s) => ({ name: s.role.name, reason: s.matchReason })),
  })

  return {
    pattern,
    teammates,
    phaseStrategy: config.phaseStrategy[phase] ?? "single",
    ctoAgent: "cto-lead",
  }
}

/**
 * Generate Task Tool instructions for the LLM.
 *
 * Instead of producing spawnTeam commands (which are Claude Code specific),
 * this produces human-readable instructions that tell the LLM how to invoke
 * OpenCode's Task Tool to spawn sub-agents in the appropriate pattern.
 *
 * Patterns:
 * - "swarm" / "parallel" -> Call ALL Task tools in a SINGLE message
 * - "council" / "pipeline" -> Call Task tools SEQUENTIALLY
 * - "leader"              -> CTO calls one Task at a time, reviews between
 * - "watchdog"            -> Run implementation Task, then watchdog Task to verify
 * - "single"              -> Single Task call
 */
export function generateTaskToolInstructions(
  phase: string,
  level: string,
  feature: string,
): string {
  const team = composeTeamForPhase(phase, level, feature)
  if (!team || team.teammates.length === 0) {
    return `No team composition available for ${level}/${phase}. Execute this phase directly without sub-agents.`
  }

  const pattern = team.pattern
  const lines: string[] = []

  lines.push(`## Task Tool Instructions: ${phase.toUpperCase()} Phase`)
  lines.push(`Feature: ${feature}`)
  lines.push(`Level: ${level}`)
  lines.push(`Pattern: ${pattern}`)
  lines.push(`CTO Agent: ${team.ctoAgent ?? "self"}`)
  lines.push("")

  switch (pattern) {
    case "swarm":
    case "parallel": {
      lines.push(
        "### Execution: PARALLEL (Swarm Pattern)",
      )
      lines.push(
        "Call ALL Task tools in a SINGLE message for parallel execution:",
      )
      lines.push("")
      for (const t of team.teammates) {
        lines.push(`- Task(${t.agentType}): "${t.task}"`)
        if (t.agents.length > 1) {
          lines.push(`  Alternative agents: ${t.agents.slice(1).join(", ")}`)
        }
      }
      lines.push("")
      lines.push("All tasks run concurrently. Collect results from all before proceeding.")
      break
    }

    case "council": {
      lines.push("### Execution: SEQUENTIAL (Council Pattern)")
      lines.push(
        "Call Task tools SEQUENTIALLY, feeding each result to the next:",
      )
      lines.push("")
      for (let i = 0; i < team.teammates.length; i++) {
        const t = team.teammates[i]
        const step = i + 1
        if (i === 0) {
          lines.push(`${step}. Task(${t.agentType}): "${t.task}"`)
        } else {
          lines.push(
            `${step}. Based on previous results -> Task(${t.agentType}): "${t.task}"`,
          )
        }
      }
      lines.push("")
      lines.push(
        "Each agent sees the output of the previous. CTO synthesizes the final council verdict.",
      )
      break
    }

    case "leader": {
      lines.push("### Execution: LEADER-DIRECTED")
      lines.push(
        "CTO directs each task one at a time, reviewing output before dispatching the next:",
      )
      lines.push("")
      for (let i = 0; i < team.teammates.length; i++) {
        const t = team.teammates[i]
        const step = i + 1
        lines.push(`${step}. Task(${t.agentType}): "${t.task}"`)
        lines.push(`   -> Review output, provide guidance if needed`)
      }
      lines.push("")
      lines.push("CTO maintains full control and reviews each deliverable before proceeding.")
      break
    }

    case "watchdog": {
      // Split teammates into implementers and verifiers
      const implementers = team.teammates.filter(
        (t) => !["qa", "reviewer", "security"].includes(t.name),
      )
      const verifiers = team.teammates.filter((t) =>
        ["qa", "reviewer", "security"].includes(t.name),
      )

      lines.push("### Execution: WATCHDOG Pattern")
      lines.push("Step 1 - Implementation (parallel):")
      for (const t of implementers) {
        lines.push(`  - Task(${t.agentType}): "${t.task}"`)
      }
      lines.push("")
      lines.push("Step 2 - Verification (sequential, after implementation completes):")
      for (const t of verifiers) {
        lines.push(`  - Task(${t.agentType}): "${t.task}"`)
      }
      lines.push("")
      lines.push(
        "If verifiers find issues, loop back to Step 1 with fix instructions.",
      )
      break
    }

    case "single":
    default: {
      lines.push("### Execution: SINGLE")
      if (team.teammates.length > 0) {
        const t = team.teammates[0]
        lines.push(`Call a single Task:`)
        lines.push(`- Task(${t.agentType}): "${t.task}"`)
      } else {
        lines.push("Execute directly without sub-agents.")
      }
      break
    }
  }

  const instructions = lines.join("\n")

  debugLog("orchestrator", "Task Tool instructions generated", {
    phase,
    level,
    feature,
    pattern,
    teammateCount: team.teammates.length,
    instructionLength: instructions.length,
  })

  return instructions
}

/**
 * Create a full phase execution context combining team composition and tasks.
 */
export function createPhaseContext(
  phase: string,
  feature: string,
  options: { level?: string; pattern?: string } = {},
): {
  phase: string
  feature: string
  level: string
  pattern: string
  team: TeamComposition | null
  tasks: TeamTask[]
  instructions: string
} {
  const level = options.level ?? "Dynamic"
  const pattern = options.pattern ?? selectOrchestrationPattern(phase, level)
  const team = composeTeamForPhase(phase, level, feature)

  // Generate tasks from team composition
  const tasks =
    team && team.teammates.length > 0
      ? createTeamTasks(phase, feature, team.teammates)
      : []

  // Generate Task Tool instructions for the LLM
  const instructions = generateTaskToolInstructions(phase, level, feature)

  return {
    phase,
    feature,
    level,
    pattern,
    team,
    tasks,
    instructions,
  }
}

/**
 * Determine whether the team needs recomposition when transitioning phases.
 *
 * Returns true when the set of active roles changes between phases.
 */
export function shouldRecomposeTeam(
  currentPhase: string,
  nextPhase: string,
  level: string,
  feature: string = "",
): boolean {
  const config = LEVEL_CONFIG[level]
  if (!config) return false

  const currentRoles = selectRolesForFeature(feature, currentPhase, level)
    .map((s) => s.role.name)
    .sort()
    .join(",")

  const nextRoles = selectRolesForFeature(feature, nextPhase, level)
    .map((s) => s.role.name)
    .sort()
    .join(",")

  return currentRoles !== nextRoles
}
