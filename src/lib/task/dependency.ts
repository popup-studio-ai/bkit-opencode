/**
 * Task Dependency Tracking
 *
 * Manages PDCA task dependencies for feature workflows.
 * Tracks blockedBy/blocks relationships and auto-unblocks when tasks complete.
 *
 * OpenCode advantage: TypeScript types + integration with TaskCreate/TaskUpdate API.
 * Gemini equivalent: lib/task/dependency.js (JavaScript, no type safety).
 */

import type { PdcaPhase } from "../pdca/phase"
import { debugLog } from "../core/debug"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDependency {
  taskId: string
  feature: string
  phase: PdcaPhase
  blockedBy: string[]
  blocks: string[]
  status: "pending" | "in_progress" | "completed"
}

// ---------------------------------------------------------------------------
// Internal state (in-memory, per session)
// ---------------------------------------------------------------------------

const _dependencies = new Map<string, TaskDependency>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Register a task dependency. Merges with existing if taskId already registered. */
export function registerDependency(taskId: string, dep: Partial<TaskDependency>): void {
  const existing = _dependencies.get(taskId)
  if (existing) {
    _dependencies.set(taskId, {
      ...existing,
      ...dep,
      blockedBy: dep.blockedBy ?? existing.blockedBy,
      blocks: dep.blocks ?? existing.blocks,
    })
  } else {
    _dependencies.set(taskId, {
      taskId,
      feature: dep.feature ?? "",
      phase: dep.phase ?? "plan",
      blockedBy: dep.blockedBy ?? [],
      blocks: dep.blocks ?? [],
      status: dep.status ?? "pending",
    })
  }
  debugLog("Dependency", "Registered", { taskId, dep })
}

/** Get dependencies for a task. Returns null if not tracked. */
export function getDependencies(taskId: string): TaskDependency | null {
  return _dependencies.get(taskId) ?? null
}

/** Get list of task IDs that block the given task. */
export function getBlockingTasks(taskId: string): string[] {
  const dep = _dependencies.get(taskId)
  if (!dep) return []
  return dep.blockedBy.filter((id) => {
    const blocker = _dependencies.get(id)
    return blocker && blocker.status !== "completed"
  })
}

/** Check if a task is currently blocked by uncompleted dependencies. */
export function isTaskBlocked(taskId: string): boolean {
  return getBlockingTasks(taskId).length > 0
}

/**
 * Mark a task as completed and return newly unblocked task IDs.
 * Automatically removes the completed task from other tasks' blockedBy lists.
 */
export function markCompleted(taskId: string): string[] {
  const dep = _dependencies.get(taskId)
  if (!dep) return []

  dep.status = "completed"
  const unblocked: string[] = []

  // Check all tasks that this one blocks
  for (const blockedId of dep.blocks) {
    const blocked = _dependencies.get(blockedId)
    if (blocked) {
      const remaining = getBlockingTasks(blockedId)
      if (remaining.length === 0 && blocked.status === "pending") {
        unblocked.push(blockedId)
      }
    }
  }

  debugLog("Dependency", "Completed", { taskId, unblocked })
  return unblocked
}

/** Get the full dependency chain for a feature, ordered by phase. */
export function getDependencyChain(feature: string): TaskDependency[] {
  const chain: TaskDependency[] = []
  for (const dep of _dependencies.values()) {
    if (dep.feature === feature) {
      chain.push(dep)
    }
  }
  // Sort by PDCA phase order
  const phaseOrder: Record<string, number> = {
    research: 0, plan: 1, design: 2, do: 3, check: 4, act: 5,
  }
  chain.sort((a, b) => (phaseOrder[a.phase] ?? 99) - (phaseOrder[b.phase] ?? 99))
  return chain
}

/** Clear all tracked dependencies. */
export function clearDependencies(): void {
  _dependencies.clear()
  debugLog("Dependency", "Cleared all dependencies")
}
