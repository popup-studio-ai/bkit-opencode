// Task Tracking Module
// Tracks PDCA task state, saves task IDs, and triggers next actions.
// Ported from bkit-claude-code lib/task/tracker.js to TypeScript for OpenCode.

import { join, dirname } from "path"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { debugLog } from "../core/debug"
import { getPdcaStatus, updateFeaturePhase } from "../pdca/status"
import { getNextPhaseGuidance, getNextPdcaPhase } from "../pdca/phase"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskChainStatus {
  exists: boolean
  feature?: string
  currentPhase?: string
  matchRate?: number
  tasks: Record<string, { taskId: string | null; status: string }>
}

export interface NextAction {
  feature: string
  nextPhase: string
  trigger: {
    skill: string
    args: string
  }
}

// ---------------------------------------------------------------------------
// Task Chain Status
// ---------------------------------------------------------------------------

export async function getTaskChainStatus(
  feature: string,
  projectDir: string,
): Promise<TaskChainStatus> {
  const status = await getPdcaStatus(projectDir)
  if (!status?.features?.[feature]) {
    return { exists: false, tasks: {} }
  }

  const featureStatus = status.features[feature]
  const currentPhase = featureStatus.phase || ""
  const phases = ["research", "plan", "design", "do", "check", "act", "report"]
  const chainStatus: Record<string, { taskId: string | null; status: string }> = {}

  const currentIdx = phases.indexOf(currentPhase)

  for (const phase of phases) {
    const phaseIdx = phases.indexOf(phase)

    // Only include completed phases and the current phase.
    // Future phases that haven't started are omitted entirely.
    if (currentPhase === phase) {
      chainStatus[phase] = { taskId: null, status: "in_progress" }
    } else if (phaseIdx < currentIdx) {
      chainStatus[phase] = { taskId: null, status: "completed" }
    }
    // else: phase hasn't started — don't include
  }

  return {
    exists: true,
    feature,
    currentPhase,
    matchRate: featureStatus.matchRate,
    tasks: chainStatus,
  }
}

// ---------------------------------------------------------------------------
// Next Action Trigger
// ---------------------------------------------------------------------------

export async function triggerNextPdcaAction(
  feature: string,
  currentPhase: string,
  context: { matchRate?: number; projectDir: string },
): Promise<NextAction | null> {
  const matchRate = context.matchRate ?? 0
  const threshold = 90

  let nextPhase: string | undefined
  if (currentPhase === "check") {
    nextPhase = matchRate >= threshold ? "report" : "act"
  } else if (currentPhase === "act") {
    nextPhase = "check"
  } else {
    const phaseOrder = ["research", "plan", "design", "do", "check", "report"]
    const currentIdx = phaseOrder.indexOf(currentPhase)
    nextPhase = currentIdx >= 0 && currentIdx < phaseOrder.length - 1
      ? phaseOrder[currentIdx + 1]
      : undefined
  }

  if (!nextPhase) return null

  debugLog("task", "Triggering next action", {
    feature,
    from: currentPhase,
    to: nextPhase,
    matchRate,
  })

  const argsMap: Record<string, string> = {
    research: `research ${feature}`,
    plan: `plan ${feature}`,
    design: `design ${feature}`,
    do: `do ${feature}`,
    check: `analyze ${feature}`,
    act: `iterate ${feature}`,
    report: `report ${feature}`,
  }

  return {
    feature,
    nextPhase,
    trigger: {
      skill: "pdca",
      args: argsMap[nextPhase] || `${nextPhase} ${feature}`,
    },
  }
}

// ---------------------------------------------------------------------------
// Current Phase Query
// ---------------------------------------------------------------------------

export async function getCurrentPdcaPhase(
  feature: string,
  projectDir: string,
): Promise<string | null> {
  const status = await getPdcaStatus(projectDir)
  return status?.features?.[feature]?.phase || null
}

// ---------------------------------------------------------------------------
// Task ID persistence
// ---------------------------------------------------------------------------

/** Save a PDCA task ID to the status file for future reference. */
export async function savePdcaTaskId(
  feature: string,
  phase: string,
  taskId: string,
  projectDir: string,
): Promise<void> {
  const status = await getPdcaStatus(projectDir)
  if (!status.features[feature]) {
    // Create minimal feature entry
    await updateFeaturePhase(projectDir, phase, feature)
  }

  // Store task IDs in memory via the status features
  const feat = status.features[feature] as any
  if (!feat.tasks) feat.tasks = {}
  feat.tasks[phase] = taskId
  feat.currentTaskId = taskId

  const path = join(projectDir, "docs/.pdca-status.json")
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(status, null, 2) + "\n")
  debugLog("task", "Saved task ID", { feature, phase, taskId })
}

/** Get a previously saved PDCA task ID. */
export async function getPdcaTaskId(
  feature: string,
  phase: string,
  projectDir: string,
): Promise<string | null> {
  const status = await getPdcaStatus(projectDir)
  const feat = status.features[feature] as any
  return feat?.tasks?.[phase] ?? null
}

/** Update task status metadata for a PDCA phase (matchRate, iterationCount, etc). */
export async function updatePdcaTaskStatus(
  phase: string,
  feature: string,
  updates: { completed?: boolean; matchRate?: number; iterationCount?: number },
  projectDir: string,
): Promise<void> {
  const status = await getPdcaStatus(projectDir)
  const feat = status.features[feature] as any
  if (!feat) return

  if (updates.completed) {
    if (!feat.timestamps) feat.timestamps = {}
    feat.timestamps[`${phase}Completed`] = new Date().toISOString()
  }
  if (updates.matchRate !== undefined) {
    feat.matchRate = updates.matchRate
  }
  if (updates.iterationCount !== undefined) {
    feat.iterations = updates.iterationCount
  }

  status.lastUpdated = new Date().toISOString()
  const path = join(projectDir, "docs/.pdca-status.json")
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(status, null, 2) + "\n")
  debugLog("task", "Updated task status", { phase, feature, updates })
}

/** Check if the .pdca-status.json file exists. Returns its path or null. */
export function findPdcaStatus(projectDir: string): string | null {
  const statusPath = join(projectDir, "docs/.pdca-status.json")
  return existsSync(statusPath) ? statusPath : null
}
