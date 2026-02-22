// Team Task Queue Module
// PDCA phase-based team task management and distribution.
// Ported from bkit-claude-code lib/team/task-queue.js to TypeScript for OpenCode.
//
// H-1 fix: Tasks are persisted to agent-state.json via state-writer.
// The in-memory Map acts as a fast cache; disk is the source of truth on restart.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "fs"
import { join } from "path"
import { debugLog } from "../core/debug"
import { generatePdcaTaskSubject, generatePdcaTaskDescription, getPdcaTaskMetadata } from "../task/creator"
import { triggerNextPdcaAction } from "../task/tracker"
import { syncTeamTasks, loadTeamTasks, type PersistedTask } from "./state-writer"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamTask {
  id: string
  roleName: string
  agentType: string
  description: string
  status: "pending" | "in_progress" | "completed" | "failed"
  phase: string
  feature: string
  assignedAt: string | null
  completedAt: string | null
  /** Human-readable task title (defaults to description if not set) */
  title: string
  /** Agent name this task is assigned to, or null if unassigned */
  assignedTo: string | null
  /** Task IDs that must complete before this task can start */
  blockedBy: string[]
  /** Result summary set on completion */
  result: string | null
}

export interface ProgressData {
  total: number
  completed: number
  inProgress: number
  pending: number
  failed: number
  completionRate: number
}

export interface TeammateInput {
  name: string
  agentType?: string
  task?: string
  description?: string
  role?: string
}

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/**
 * In-memory task cache. Synced to agent-state.json on every mutation.
 * On first access, hydrated from disk if empty.
 */
const taskStore = new Map<string, TeamTask>()

let _idCounter = 0
// #11 fix: track hydration per directory to support multi-project processes
let _hydratedDir: string | null = null

/** Shared tasks file path relative to project root */
const SHARED_TASKS_FILE = ".bkit/shared-tasks.json"

function generateTaskId(phase: string, roleName: string): string {
  _idCounter++
  return `task-${phase}-${roleName}-${_idCounter}-${Date.now().toString(36)}`
}

/**
 * Persist current taskStore to .bkit/shared-tasks.json (atomic write).
 * Also syncs to agent-state.json for backward compatibility.
 */
export function syncToDisk(directory?: string): void {
  if (!directory) return
  try {
    const tasks = Array.from(taskStore.values())

    // Write to shared-tasks.json (atomic: tmp + rename)
    const filePath = join(directory, SHARED_TASKS_FILE)
    const dir = join(directory, ".bkit")
    const tmpPath = filePath + ".tmp"
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(tmpPath, JSON.stringify({ version: "1.0", lastUpdated: new Date().toISOString(), tasks }, null, 2))
    renameSync(tmpPath, filePath)

    // Also sync to agent-state.json for backward compatibility
    syncTeamTasks(directory, tasks as PersistedTask[])
  } catch (e: any) {
    debugLog("task-queue", "Failed to sync tasks to disk (non-fatal)", { error: e?.message })
  }
}

/**
 * Hydrate in-memory taskStore from disk on first access.
 * Reads .bkit/shared-tasks.json first, falls back to agent-state.json .tasks field.
 * Only runs once per directory.
 */
export function hydrateFromDisk(directory: string): void {
  if (_hydratedDir === directory) return
  _hydratedDir = directory

  try {
    let persisted: PersistedTask[] = []

    // Try shared-tasks.json first
    const sharedPath = join(directory, SHARED_TASKS_FILE)
    if (existsSync(sharedPath)) {
      try {
        const content = readFileSync(sharedPath, "utf8")
        const parsed = JSON.parse(content)
        if (parsed?.version === "1.0" && Array.isArray(parsed.tasks)) {
          persisted = parsed.tasks
          debugLog("task-queue", "Hydrated from shared-tasks.json", { count: persisted.length })
        }
      } catch {
        // Fall through to agent-state.json
      }
    }

    // Fallback to agent-state.json .tasks field
    if (persisted.length === 0) {
      persisted = loadTeamTasks(directory)
    }

    if (persisted.length > 0) {
      for (const task of persisted) {
        // Default new fields for tasks loaded from older format
        const hydrated: TeamTask = {
          ...(task as TeamTask),
          title: (task as any).title ?? task.description,
          assignedTo: (task as any).assignedTo ?? null,
          blockedBy: (task as any).blockedBy ?? [],
          result: (task as any).result ?? null,
        }
        taskStore.set(hydrated.id, hydrated)
      }
      // Restore id counter to avoid collisions
      _idCounter = persisted.length
      debugLog("task-queue", "Hydrated from disk", { count: persisted.length })
    }
  } catch (e: any) {
    debugLog("task-queue", "Failed to hydrate from disk (non-fatal)", { error: e?.message })
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create team tasks for a PDCA phase based on composed teammates.
 *
 * Each teammate entry produces one TeamTask.  The tasks are stored in-memory,
 * persisted to agent-state.json, and also returned for immediate use.
 */
export function createTeamTasks(
  phase: string,
  feature: string,
  teammates: TeammateInput[],
  directory?: string,
): TeamTask[] {
  if (!teammates || teammates.length === 0) return []

  const tasks: TeamTask[] = []

  for (const teammate of teammates) {
    const roleName = teammate.name ?? teammate.role ?? "agent"
    const agentType = teammate.agentType ?? "auto"
    const description =
      teammate.task ??
      teammate.description ??
      `Execute ${phase} phase work for ${feature} as ${roleName}`

    const task: TeamTask = {
      id: generateTaskId(phase, roleName),
      roleName,
      agentType,
      description,
      status: "pending",
      phase,
      feature,
      assignedAt: null,
      completedAt: null,
      title: description,
      assignedTo: null,
      blockedBy: [],
      result: null,
    }

    taskStore.set(task.id, task)
    tasks.push(task)

    debugLog("task-queue", "Team task created", { id: task.id, roleName, phase, feature })
  }

  syncToDisk(directory)
  return tasks
}

/**
 * Find the next available (pending) task from the store.
 *
 * Optionally filter by feature and/or phase.  Returns null when nothing is
 * available.
 */
export function findNextAvailableTask(
  tasks: TeamTask[],
  filter?: { feature?: string; phase?: string; roleName?: string },
): TeamTask | null {
  for (const task of tasks) {
    if (task.status !== "pending") continue
    if (filter?.feature && task.feature !== filter.feature) continue
    if (filter?.phase && task.phase !== filter.phase) continue
    if (filter?.roleName && task.roleName !== filter.roleName) continue
    return task
  }
  return null
}

/**
 * Compute progress summary for a list of tasks.
 */
export function getTeamProgress(tasks: TeamTask[]): ProgressData {
  let total = 0
  let completed = 0
  let inProgress = 0
  let pending = 0
  let failed = 0

  for (const task of tasks) {
    total++
    switch (task.status) {
      case "completed":
        completed++
        break
      case "in_progress":
        inProgress++
        break
      case "failed":
        failed++
        break
      case "pending":
      default:
        pending++
        break
    }
  }

  return {
    total,
    completed,
    inProgress,
    pending,
    failed,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
  }
}

/**
 * Mark a task as in-progress.
 */
export function startTask(taskId: string, directory?: string): void {
  const task = taskStore.get(taskId)
  if (!task) return
  task.status = "in_progress"
  task.assignedAt = new Date().toISOString()
  syncToDisk(directory)
  debugLog("task-queue", "Task started", { taskId, roleName: task.roleName })
}

/**
 * Mark a task as completed.
 */
export function completeTask(taskId: string, directory?: string): void {
  const task = taskStore.get(taskId)
  if (!task) return
  task.status = "completed"
  task.completedAt = new Date().toISOString()
  syncToDisk(directory)
  debugLog("task-queue", "Task completed", { taskId, roleName: task.roleName })
}

/**
 * Mark a task as failed.
 */
export function failTask(taskId: string, directory?: string): void {
  const task = taskStore.get(taskId)
  if (!task) return
  task.status = "failed"
  task.completedAt = new Date().toISOString()
  syncToDisk(directory)
  debugLog("task-queue", "Task failed", { taskId, roleName: task.roleName })
}

/**
 * Check if all tasks for a feature/phase are complete.
 */
export function isPhaseComplete(feature: string, phase: string): boolean {
  const phaseTasks: TeamTask[] = []
  for (const task of taskStore.values()) {
    if (task.feature === feature && task.phase === phase) {
      phaseTasks.push(task)
    }
  }
  if (phaseTasks.length === 0) return false
  return phaseTasks.every((t) => t.status === "completed")
}

/**
 * Get all stored tasks, optionally filtered.
 * Hydrates from disk on first call if the in-memory store is empty.
 */
export function getStoredTasks(filter?: { feature?: string; phase?: string }, directory?: string): TeamTask[] {
  // Hydrate from disk on first access
  if (directory && _hydratedDir !== directory) {
    hydrateFromDisk(directory)
  }

  const results: TeamTask[] = []
  for (const task of taskStore.values()) {
    if (filter?.feature && task.feature !== filter.feature) continue
    if (filter?.phase && task.phase !== filter.phase) continue
    results.push(task)
  }
  return results
}

/**
 * Clear all in-memory tasks and sync to disk.
 */
export function clearTasks(directory?: string): void {
  taskStore.clear()
  _idCounter = 0
  _hydratedDir = null
  syncToDisk(directory)
  debugLog("task-queue", "All tasks cleared")
}

// ---------------------------------------------------------------------------
// Single-Task CRUD API (used by bkit-task-board tool)
// ---------------------------------------------------------------------------

/**
 * Create a single task with explicit fields (not tied to PDCA teammate creation).
 */
export function createSingleTask(
  fields: {
    title: string
    description?: string
    blockedBy?: string[]
    assignedTo?: string | null
    phase?: string
    feature?: string
  },
  directory?: string,
): TeamTask {
  const phase = fields.phase ?? "do"
  const feature = fields.feature ?? "shared"

  const task: TeamTask = {
    id: generateTaskId(phase, "board"),
    roleName: fields.assignedTo ?? "unassigned",
    agentType: "auto",
    description: fields.description ?? fields.title,
    status: "pending",
    phase,
    feature,
    assignedAt: null,
    completedAt: null,
    title: fields.title,
    assignedTo: fields.assignedTo ?? null,
    blockedBy: fields.blockedBy ?? [],
    result: null,
  }

  taskStore.set(task.id, task)
  syncToDisk(directory)
  debugLog("task-queue", "Single task created", { id: task.id, title: task.title })
  return task
}

/**
 * Update a task's mutable fields (status, assignedTo).
 * Returns the updated task, or null if not found.
 */
export function updateTask(
  taskId: string,
  fields: { status?: TeamTask["status"]; assignedTo?: string | null },
  directory?: string,
): TeamTask | null {
  if (directory && _hydratedDir !== directory) {
    hydrateFromDisk(directory)
  }

  const task = taskStore.get(taskId)
  if (!task) return null

  if (fields.status !== undefined) {
    task.status = fields.status
    if (fields.status === "in_progress" && !task.assignedAt) {
      task.assignedAt = new Date().toISOString()
    }
    if (fields.status === "completed" || fields.status === "failed") {
      task.completedAt = new Date().toISOString()
    }
  }
  if (fields.assignedTo !== undefined) {
    task.assignedTo = fields.assignedTo
    task.roleName = fields.assignedTo ?? "unassigned"
  }

  syncToDisk(directory)
  debugLog("task-queue", "Task updated", { taskId, fields })
  return task
}

/**
 * Get a single task by ID.
 * Returns null if not found.
 */
export function getTask(taskId: string, directory?: string): TeamTask | null {
  if (directory && _hydratedDir !== directory) {
    hydrateFromDisk(directory)
  }
  return taskStore.get(taskId) ?? null
}
