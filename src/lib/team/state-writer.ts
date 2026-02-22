// Team State Writer Module
// Disk persistence for team runtime state (agent-state.json).
// Ported from bkit-claude-code lib/team/state-writer.js to TypeScript for OpenCode.
//
// Uses Node.js fs with atomic writes (write to .tmp then rename)
// to prevent corruption.

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from "fs"
import { debugLog } from "../core/debug"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeammateState {
  name: string
  role: string
  model: string
  status: "spawning" | "working" | "idle" | "completed" | "failed"
  currentTask: string | null
  taskId: string | null
  /** Child session ID for event-driven lifecycle tracking */
  sessionId?: string | null
  startedAt: string
  lastActivityAt: string
}

export interface ProgressState {
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  failedTasks: number
  pendingTasks: number
}

export interface RecentMessage {
  from: string
  to: string
  content: string
  timestamp: string
}

/** Persisted team task (mirrors task-queue.ts TeamTask) */
export interface PersistedTask {
  id: string
  roleName: string
  agentType: string
  description: string
  status: "pending" | "in_progress" | "completed" | "failed"
  phase: string
  feature: string
  assignedAt: string | null
  completedAt: string | null
}

export interface AgentState {
  version: string
  enabled: boolean
  teamName: string
  feature: string
  pdcaPhase: string
  orchestrationPattern: string
  ctoAgent: string
  startedAt: string
  lastUpdated: string
  teammates: TeammateState[]
  progress: ProgressState
  recentMessages: RecentMessage[]
  sessionId: string
  /** Persisted team tasks — survives server restarts */
  tasks?: PersistedTask[]
}

export interface InitOptions {
  pdcaPhase?: string
  orchestrationPattern?: string
  ctoAgent?: string
  sessionId?: string
}

export interface TeammateInfo {
  name: string
  role?: string
  model?: string
  currentTask?: string
  taskId?: string
  /** Child session ID for event-driven lifecycle tracking */
  sessionId?: string
}

export interface TaskInfo {
  task?: string
  taskId?: string
}

export interface ProgressData {
  total: number
  completed: number
  inProgress: number
  pending: number
  failed?: number
}

export interface MessageInfo {
  from: string
  to: string
  content: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TEAMMATES = 10
const MAX_MESSAGES = 50

// ---------------------------------------------------------------------------
// Default State Factory
// ---------------------------------------------------------------------------

function createDefaultAgentState(): AgentState {
  const now = new Date().toISOString()
  return {
    version: "1.0",
    enabled: false,
    teamName: "",
    feature: "",
    pdcaPhase: "plan",
    orchestrationPattern: "leader",
    ctoAgent: "opus",
    startedAt: now,
    lastUpdated: now,
    teammates: [],
    progress: {
      totalTasks: 0,
      completedTasks: 0,
      inProgressTasks: 0,
      failedTasks: 0,
      pendingTasks: 0,
    },
    recentMessages: [],
    sessionId: "",
  }
}

// ---------------------------------------------------------------------------
// File I/O (Node.js fs with atomic writes)
// ---------------------------------------------------------------------------

/**
 * Return the path to .bkit/agent-state.json under the given directory.
 */
export function getAgentStatePath(directory: string): string {
  return `${directory}/.bkit/agent-state.json`
}

/**
 * Read the current agent state from disk.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readAgentState(directory: string): AgentState | null {
  const statePath = getAgentStatePath(directory)
  try {
    if (!existsSync(statePath)) return null

    const content = readFileSync(statePath, "utf8")
    return JSON.parse(content) as AgentState
  } catch (e: any) {
    debugLog("state-writer", "Failed to read agent state", { error: e?.message })
    return null
  }
}

/**
 * Write the agent state to disk atomically.
 * Writes to a .tmp file first, then renames to the target path.
 */
/** Exported for batched I/O in tool-after (B4 fix: read once → mutate → write once). */
export function writeAgentState(state: AgentState, directory: string): void {
  const statePath = getAgentStatePath(directory)
  const stateDir = statePath.replace(/\/[^/]+$/, "") // dirname
  const tmpPath = statePath + ".tmp"

  try {
    // Ensure directory exists
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true })
    }

    // Update timestamp
    state.lastUpdated = new Date().toISOString()

    // Atomic write: write to tmp, then rename
    writeFileSync(tmpPath, JSON.stringify(state, null, 2))
    renameSync(tmpPath, statePath)

    debugLog("state-writer", "Agent state written", {
      enabled: state.enabled,
      teammateCount: state.teammates.length,
    })
  } catch (e: any) {
    debugLog("state-writer", "Failed to write agent state (non-fatal)", {
      error: e?.message,
    })
    // Attempt to clean up tmp file
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize agent state when a team session begins.
 */
export function initAgentState(
  teamName: string,
  feature: string,
  options: InitOptions,
  directory: string,
): void {
  const state = createDefaultAgentState()

  state.enabled = true
  state.teamName = teamName || ""
  state.feature = feature || ""
  state.pdcaPhase = options.pdcaPhase ?? "plan"
  state.orchestrationPattern = options.orchestrationPattern ?? "leader"
  state.ctoAgent = options.ctoAgent ?? "opus"
  state.sessionId = options.sessionId ?? ""
  state.startedAt = new Date().toISOString()

  writeAgentState(state, directory)

  debugLog("state-writer", "Agent state initialized", {
    teamName,
    feature,
    pdcaPhase: state.pdcaPhase,
  })
}

/**
 * Add a teammate to the roster.
 * If a teammate with the same name already exists, its entry is updated
 * (preserving the original startedAt timestamp).
 */
export function addTeammate(info: TeammateInfo, directory: string): void {
  const state = readAgentState(directory)
  if (!state) {
    debugLog("state-writer", "Cannot add teammate - no agent state file")
    return
  }

  const existingIdx = state.teammates.findIndex((t) => t.name === info.name)
  const now = new Date().toISOString()

  const teammate: TeammateState = {
    name: info.name,
    role: info.role ?? "agent",
    model: info.model ?? "sonnet",
    status: "spawning",
    currentTask: info.currentTask ?? null,
    taskId: info.taskId ?? null,
    sessionId: info.sessionId ?? null,
    startedAt: now,
    lastActivityAt: now,
  }

  if (existingIdx >= 0) {
    const existing = state.teammates[existingIdx]
    // B6 fix: If existing teammate is still active, don't overwrite — add with suffix
    // to avoid losing tracking for the first agent's session.
    if (existing.status === "spawning" || existing.status === "working") {
      const sameNameCount = state.teammates.filter(t => t.name.startsWith(info.name)).length
      teammate.name = `${info.name}-${sameNameCount}`
      if (state.teammates.length >= MAX_TEAMMATES) {
        debugLog("state-writer", `Max teammates (${MAX_TEAMMATES}) reached, skipping add`)
        return
      }
      state.teammates.push(teammate)
    } else {
      // Existing is completed/failed — safe to reuse slot
      teammate.startedAt = existing.startedAt
      state.teammates[existingIdx] = teammate
    }
  } else {
    if (state.teammates.length >= MAX_TEAMMATES) {
      debugLog("state-writer", `Max teammates (${MAX_TEAMMATES}) reached, skipping add`)
      return
    }
    state.teammates.push(teammate)
  }

  writeAgentState(state, directory)
}

/**
 * Update a teammate's status and optionally its current task info.
 */
export function updateTeammateStatus(
  name: string,
  status: TeammateState["status"],
  taskInfo: TaskInfo | null,
  directory: string,
): void {
  const state = readAgentState(directory)
  if (!state) return

  const teammate = state.teammates.find((t) => t.name === name)
  if (!teammate) {
    debugLog("state-writer", "Teammate not found for status update", { name })
    return
  }

  teammate.status = status
  teammate.lastActivityAt = new Date().toISOString()

  if (taskInfo) {
    teammate.currentTask = taskInfo.task ?? null
    teammate.taskId = taskInfo.taskId ?? null
  } else if (status === "idle" || status === "completed") {
    teammate.currentTask = null
    teammate.taskId = null
  }

  writeAgentState(state, directory)
}

/**
 * Remove a teammate from the roster.
 */
export function removeTeammate(name: string, directory: string): void {
  const state = readAgentState(directory)
  if (!state) return

  const beforeCount = state.teammates.length
  state.teammates = state.teammates.filter((t) => t.name !== name)

  if (state.teammates.length < beforeCount) {
    writeAgentState(state, directory)
    debugLog("state-writer", "Teammate removed", { name })
  }
}

/**
 * Update progress counters.
 */
export function updateProgress(data: ProgressData, directory: string): void {
  const state = readAgentState(directory)
  if (!state) return

  state.progress = {
    totalTasks: data.total ?? 0,
    completedTasks: data.completed ?? 0,
    inProgressTasks: data.inProgress ?? 0,
    failedTasks: data.failed ?? 0,
    pendingTasks: data.pending ?? 0,
  }

  writeAgentState(state, directory)
}

/**
 * Append a message to the recent messages ring buffer (max 50).
 */
export function addRecentMessage(msg: MessageInfo, directory: string): void {
  const state = readAgentState(directory)
  if (!state) return

  const entry: RecentMessage = {
    from: msg.from ?? "unknown",
    to: msg.to ?? "all",
    content: msg.content ?? "",
    timestamp: new Date().toISOString(),
  }

  state.recentMessages.push(entry)

  // Ring buffer: keep only the most recent MAX_MESSAGES entries
  if (state.recentMessages.length > MAX_MESSAGES) {
    state.recentMessages = state.recentMessages.slice(-MAX_MESSAGES)
  }

  writeAgentState(state, directory)
}

// ---------------------------------------------------------------------------
// Task Persistence (H-1 fix: sync in-memory task queue to disk)
// ---------------------------------------------------------------------------

/**
 * Sync the current task list to agent-state.json.
 * Called by task-queue.ts after every mutation.
 */
export function syncTeamTasks(directory: string, tasks: PersistedTask[]): void {
  const state = readAgentState(directory)
  if (!state) return
  state.tasks = tasks
  writeAgentState(state, directory)
}

/**
 * Load persisted tasks from agent-state.json.
 * Called by task-queue.ts on first access to hydrate the in-memory store.
 */
export function loadTeamTasks(directory: string): PersistedTask[] {
  const state = readAgentState(directory)
  return state?.tasks ?? []
}

// ---------------------------------------------------------------------------
// Phase & Cleanup
// ---------------------------------------------------------------------------

/**
 * Update the PDCA phase in the agent state.
 * Used when team transitions to a new phase.
 */
export function updateAgentPhase(directory: string, pdcaPhase: string): void {
  const state = readAgentState(directory)
  if (!state) return
  state.pdcaPhase = pdcaPhase
  writeAgentState(state, directory)
  debugLog("state-writer", "Agent phase updated", { pdcaPhase })
}

/**
 * Clean up agent state when a session ends.
 * Sets enabled=false and clears teammates, but preserves progress and messages
 * so external tools (e.g. bkit Studio) can display the final state.
 */
export function cleanupAgentState(directory: string): void {
  const state = readAgentState(directory)
  if (!state) return

  state.enabled = false
  state.teammates = []
  // progress and recentMessages are intentionally preserved

  writeAgentState(state, directory)

  debugLog("state-writer", "Agent state cleaned up", {
    feature: state.feature,
    preservedMessages: state.recentMessages.length,
  })
}
