// Team Coordinator Module
// Agent Teams availability checking and team configuration management.
// Ported from bkit-claude-code lib/team/coordinator.js to TypeScript for OpenCode.
//
// KEY DIFFERENCE: In OpenCode, team mode is always available because it uses
// the Task Tool for agent spawning. No special environment variable is needed.

import { debugLog } from "../core/debug"
import { getConfig, type TeamConfig } from "../core/config"
import { TEAM_STRATEGIES, type TeamStrategy } from "./strategy"
import type { AgentState } from "./state-writer"
import { createPhaseTransitionNotice, createBroadcast } from "./communication"
import { decidePdcaPhase, recommendTeamComposition } from "./cto-logic"
import { composeTeamForPhase } from "./orchestrator"
import { createTeamTasks, findNextAvailableTask, getStoredTasks } from "./task-queue"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { TeamConfig, TeamStrategy }

export interface TeamSuggestion {
  suggest: boolean
  reason: string
  level: string
}

// ---------------------------------------------------------------------------
// Team Keywords
// ---------------------------------------------------------------------------

/**
 * Keywords that suggest the user wants team-mode collaboration.
 * Covers English and Korean terms commonly used in bkit contexts.
 */
const TEAM_KEYWORDS = [
  // English
  "team",
  "teammates",
  "collaborate",
  "multi-agent",
  "parallel",
  "swarm",
  "council",
  "orchestrat",
  "cto",
  "architect",
  "full-stack",
  "enterprise",
  "major feature",
  "large feature",
  "complex feature",
  "comprehensive",
  // Korean
  "\uD300",
  "\uD300\uC6D0",
  "\uD611\uC5C5",
  "\uC624\uCF00\uC2A4\uD2B8\uB808\uC774\uC158",
  "\uBCD1\uB82C",
  "\uB300\uADDC\uBAA8",
] as const

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether Team Mode is available.
 *
 * In OpenCode, team mode is always available because it is implemented via
 * the Task Tool (sub-agent spawning), not Claude Code's experimental
 * environment variable.
 */
export function isTeamModeAvailable(): boolean {
  return true
}

/**
 * Load the team configuration from bkit.config.json.
 *
 * Falls back to safe defaults when the config has not been loaded yet.
 */
export function getTeamConfig(directory?: string): TeamConfig {
  try {
    const enabled = getConfig("team.enabled", false) as boolean
    const maxTeammates = getConfig("team.maxTeammates", 4) as number
    const orchestrationPatterns = getConfig("team.orchestrationPatterns", {}) as Record<
      string,
      any
    >

    return { enabled, maxTeammates, orchestrationPatterns }
  } catch {
    // Config not loaded yet - return defaults
    return {
      enabled: false,
      maxTeammates: 4,
      orchestrationPatterns: {},
    }
  }
}

/**
 * Generate a team strategy for a given project level and feature.
 *
 * - Starter: returns null (team mode not supported)
 * - Dynamic: recommended max 3 agents, varies by feature context
 * - Enterprise: recommended max 5 agents, varies by feature context
 *
 * Falls back to the Dynamic strategy for unknown levels.
 */
export function generateTeamStrategy(
  level: string,
  feature: string,
): TeamStrategy | null {
  const strategy = TEAM_STRATEGIES[level]

  // Explicit null for Starter means team mode is not applicable
  if (level === "Starter") return null

  // Unknown level - fall back to Dynamic
  if (strategy === undefined) {
    debugLog("coordinator", `Unknown level "${level}", falling back to Dynamic strategy`)
    return TEAM_STRATEGIES.Dynamic as TeamStrategy
  }

  return strategy as TeamStrategy | null
}

/**
 * Format a human-readable team status output.
 *
 * Combines the team's runtime state with optional PDCA status info.
 */
export function formatTeamStatus(
  teamState: AgentState | null,
  pdcaStatus?: {
    primaryFeature?: string
    features?: Record<string, { phase?: string; matchRate?: number }>
  },
): string {
  const available = isTeamModeAvailable()
  const config = getTeamConfig()

  const lines: string[] = []

  lines.push("## Agent Teams Status")
  lines.push(`- Available: ${available ? "Yes" : "No"}`)
  lines.push(`- Enabled: ${config.enabled ? "Yes" : "No"}`)
  lines.push(`- Max Teammates: ${config.maxTeammates}`)

  if (teamState?.enabled) {
    lines.push("")
    lines.push("### Active Team")
    lines.push(`- Team: ${teamState.teamName}`)
    lines.push(`- Feature: ${teamState.feature}`)
    lines.push(`- Phase: ${teamState.pdcaPhase}`)
    lines.push(`- Pattern: ${teamState.orchestrationPattern}`)
    lines.push(`- CTO Agent: ${teamState.ctoAgent}`)
    lines.push(`- Session: ${teamState.sessionId || "N/A"}`)

    if (teamState.teammates.length > 0) {
      lines.push("")
      lines.push("### Teammates")
      for (const t of teamState.teammates) {
        const taskLabel = t.currentTask ? ` | Task: ${t.currentTask}` : ""
        lines.push(`- ${t.name} (${t.role}/${t.model}): ${t.status}${taskLabel}`)
      }
    }

    const p = teamState.progress
    if (p.totalTasks > 0) {
      lines.push("")
      lines.push("### Progress")
      lines.push(
        `- Total: ${p.totalTasks} | Completed: ${p.completedTasks} | In Progress: ${p.inProgressTasks} | Pending: ${p.pendingTasks} | Failed: ${p.failedTasks}`,
      )
      const rate =
        p.totalTasks > 0 ? Math.round((p.completedTasks / p.totalTasks) * 100) : 0
      lines.push(`- Completion: ${rate}%`)
    }
  }

  if (pdcaStatus?.primaryFeature) {
    lines.push("")
    lines.push("### PDCA Integration")
    lines.push(`- Feature: ${pdcaStatus.primaryFeature}`)
    const featureData = pdcaStatus.features?.[pdcaStatus.primaryFeature]
    if (featureData) {
      lines.push(`- Phase: ${featureData.phase ?? "unknown"}`)
      if (featureData.matchRate != null) {
        lines.push(`- Match Rate: ${featureData.matchRate}%`)
      }
    }
  }

  return lines.join("\n")
}

/**
 * Suggest team mode if the user's message indicates a need for it.
 *
 * Returns a suggestion when:
 * 1. The message is >= 1000 characters (indicates a major feature request)
 * 2. Team-related keywords are detected in the message
 *
 * Returns null when:
 * - The detected level is Starter (team mode not applicable)
 * - No team indicators are found
 */
export function suggestTeamMode(
  userMessage: string,
  opts?: { directory?: string; level?: string },
): TeamSuggestion | null {
  // Determine project level
  let level = opts?.level ?? "Dynamic"

  // Starter projects do not use team mode
  if (level === "Starter") return null

  const messageLength = userMessage ? userMessage.length : 0

  // Check 1: Long messages suggest major features
  if (messageLength >= 1000) {
    return {
      suggest: true,
      reason: "Major feature detected (message length >= 1000 chars)",
      level,
    }
  }

  // Check 2: Team-related keywords in the message
  if (userMessage) {
    const lowerMessage = userMessage.toLowerCase()
    for (const keyword of TEAM_KEYWORDS) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        return {
          suggest: true,
          reason: `Team-related keyword detected: "${keyword}"`,
          level,
        }
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Phase Transition & Idle Handling
// ---------------------------------------------------------------------------

/**
 * Determine the next work assignment after a teammate completes a PDCA phase.
 *
 * Uses CTO logic to decide the next phase, then composes a team, creates
 * tasks, and generates a phase transition notice for broadcasting.
 *
 * Returns null when there is no next phase or the project level doesn't
 * support team mode.
 */
export function assignNextTeammateWork(
  completedPhase: string,
  feature: string,
  level: string,
  directory?: string,
): {
  nextPhase: string
  team: ReturnType<typeof composeTeamForPhase>
  tasks: ReturnType<typeof createTeamTasks>
  notice: ReturnType<typeof createPhaseTransitionNotice>
} | null {
  // Determine next phase via CTO decision logic
  const decision = decidePdcaPhase({ phase: completedPhase })

  if (!decision.nextPhase) {
    debugLog("coordinator", "No next phase after completion", {
      completedPhase,
      feature,
    })
    return null
  }

  const nextPhase = decision.nextPhase

  // Compose team for the next phase
  const team = composeTeamForPhase(nextPhase, level, feature)
  if (!team) {
    debugLog("coordinator", "Cannot compose team for next phase", {
      nextPhase,
      level,
      feature,
    })
    return null
  }

  // Create tasks for the new team (persisted to agent-state.json when directory provided)
  const tasks = createTeamTasks(nextPhase, feature, team.teammates, directory)

  // Create phase transition broadcast notice
  const notice = createPhaseTransitionNotice(feature, completedPhase, nextPhase)

  debugLog("coordinator", "Next teammate work assigned", {
    completedPhase,
    nextPhase,
    feature,
    level,
    taskCount: tasks.length,
  })

  return { nextPhase, team, tasks, notice }
}

/**
 * Handle a teammate that has become idle after completing its assigned task.
 *
 * Looks up the next available pending task from the task queue and returns
 * a suggestion for the teammate.  Returns null when no work is available.
 */
export function handleTeammateIdle(
  teammateId: string,
  pdcaStatus: { feature?: string; phase?: string } | null,
  directory?: string,
): {
  teammateId: string
  feature: string
  currentPhase: string
  nextTask: ReturnType<typeof findNextAvailableTask>
  suggestion: string
} | null {
  const feature = pdcaStatus?.feature ?? ""
  const currentPhase = pdcaStatus?.phase ?? "plan"

  // Look for pending tasks matching current feature/phase
  const storedTasks = getStoredTasks({ feature: feature || undefined, phase: currentPhase }, directory)
  const nextTask = findNextAvailableTask(storedTasks, {
    feature: feature || undefined,
    phase: currentPhase,
  })

  if (!nextTask) {
    debugLog("coordinator", "No available task for idle teammate", {
      teammateId,
      feature,
      currentPhase,
    })
    return null
  }

  const suggestion = `Assign task "${nextTask.description}" (${nextTask.roleName}) to teammate`

  debugLog("coordinator", "Idle teammate matched to task", {
    teammateId,
    taskId: nextTask.id,
    roleName: nextTask.roleName,
  })

  return {
    teammateId,
    feature,
    currentPhase,
    nextTask,
    suggestion,
  }
}
