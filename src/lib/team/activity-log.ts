// Agent Activity Log Module
// Unified activity log for all agent invocations (sync + background).
// Persists to .bkit/agent-activity.json with atomic writes (tmp + rename).
// Ring buffer keeps the most recent MAX_ENTRIES entries.

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from "fs"
import { debugLog } from "../core/debug"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  id: string                    // jobId (bg) or "sync-{hex}"
  startedAt: string             // ISO timestamp
  completedAt: string | null
  agentName: string
  taskSummary: string           // max 150 chars
  mode: "sync" | "background"
  status: "running" | "completed" | "failed" | "aborted" | "timeout"
  durationSec: number | null
  resultSummary: string | null  // max 200 chars
  sessionId: string
  continuation: boolean
}

interface ActivityLog {
  version: "1.0"
  entries: ActivityEntry[]
}

export interface SpawnParams {
  id: string
  agentName: string
  taskSummary: string
  sessionId: string
  mode: "sync" | "background"
  continuation: boolean
}

export interface ActivityFilters {
  agent?: string        // partial match
  status?: ActivityEntry["status"]
  mode?: "sync" | "background"
  last?: number         // default 20, max 100
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 100

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function getActivityPath(directory: string): string {
  return `${directory}/.bkit/agent-activity.json`
}

function readActivityLog(directory: string): ActivityLog {
  const filePath = getActivityPath(directory)
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf8")
      const parsed = JSON.parse(content)
      if (parsed?.version === "1.0" && Array.isArray(parsed.entries)) {
        return parsed as ActivityLog
      }
    }
  } catch (e: any) {
    debugLog("activity-log", "Failed to read activity log", { error: e?.message })
  }
  return { version: "1.0", entries: [] }
}

function writeActivityLog(log: ActivityLog, directory: string): void {
  const filePath = getActivityPath(directory)
  const dir = filePath.replace(/\/[^/]+$/, "")
  const tmpPath = filePath + ".tmp"

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(tmpPath, JSON.stringify(log, null, 2))
    renameSync(tmpPath, filePath)
  } catch (e: any) {
    debugLog("activity-log", "Failed to write activity log (non-fatal)", { error: e?.message })
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
 * Record a new agent spawn (sync or background).
 * Applies ring buffer (max 100 entries).
 */
export function recordAgentSpawn(directory: string, params: SpawnParams): void {
  const log = readActivityLog(directory)

  const entry: ActivityEntry = {
    id: params.id,
    startedAt: new Date().toISOString(),
    completedAt: null,
    agentName: params.agentName,
    taskSummary: params.taskSummary.slice(0, 150),
    mode: params.mode,
    status: "running",
    durationSec: null,
    resultSummary: null,
    sessionId: params.sessionId,
    continuation: params.continuation,
  }

  log.entries.push(entry)

  // Ring buffer: keep most recent MAX_ENTRIES
  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(-MAX_ENTRIES)
  }

  writeActivityLog(log, directory)
  debugLog("activity-log", "Agent spawn recorded", { id: params.id, agent: params.agentName, mode: params.mode })
}

/**
 * Record agent completion (idempotent).
 * Reverse-searches for a running entry matching the sessionId.
 * If already completed, this is a no-op.
 */
export function recordAgentCompletion(
  directory: string,
  sessionId: string,
  status: "completed" | "failed" | "aborted" | "timeout",
  resultSummary?: string,
): void {
  const log = readActivityLog(directory)

  // Reverse search: find the most recent running entry for this sessionId
  let target: ActivityEntry | undefined
  for (let i = log.entries.length - 1; i >= 0; i--) {
    const e = log.entries[i]
    if (e.sessionId === sessionId && e.status === "running") {
      target = e
      break
    }
  }

  if (!target) {
    // Already completed or no matching spawn — idempotent no-op
    debugLog("activity-log", "No running entry for sessionId (idempotent skip)", { sessionId, status })
    return
  }

  target.status = status
  target.completedAt = new Date().toISOString()
  target.durationSec = Math.round(
    (new Date(target.completedAt).getTime() - new Date(target.startedAt).getTime()) / 1000,
  )
  if (resultSummary) {
    target.resultSummary = resultSummary.slice(0, 200)
  }

  writeActivityLog(log, directory)
  debugLog("activity-log", "Agent completion recorded", {
    id: target.id,
    agent: target.agentName,
    status,
    durationSec: target.durationSec,
  })
}

/**
 * Get the most recent N activity entries (for system prompt injection).
 */
export function getRecentActivity(directory: string, count: number = 5): ActivityEntry[] {
  const log = readActivityLog(directory)
  return log.entries.slice(-count)
}

/**
 * Query activity entries with optional filters (for the user tool).
 */
export function queryActivity(directory: string, filters?: ActivityFilters): ActivityEntry[] {
  const log = readActivityLog(directory)
  let results = log.entries

  if (filters?.agent) {
    const pattern = filters.agent.toLowerCase()
    results = results.filter(e => e.agentName.toLowerCase().includes(pattern))
  }

  if (filters?.status) {
    results = results.filter(e => e.status === filters.status)
  }

  if (filters?.mode) {
    results = results.filter(e => e.mode === filters.mode)
  }

  const limit = Math.min(Math.max(filters?.last ?? 20, 1), 100)
  return results.slice(-limit)
}

/**
 * Format activity entries for system prompt injection.
 * Compact one-line-per-entry format, ~60 tokens per entry.
 */
export function formatActivityForPrompt(entries: ActivityEntry[]): string {
  if (entries.length === 0) return ""

  const lines = entries.map(e => {
    const ago = formatTimeAgo(e.startedAt)
    const task = e.taskSummary.length > 40
      ? e.taskSummary.slice(0, 37) + "..."
      : e.taskSummary

    if (e.status === "running") {
      return `- [${ago}] ${e.agentName}: "${task}" -> running...`
    }

    const dur = e.durationSec !== null ? `${e.durationSec}s` : "?"
    return `- [${ago}] ${e.agentName}: "${task}" -> ${e.status} (${dur})`
  })

  return `## Recent Agent Activity\n${lines.join("\n")}`
}

// ---------------------------------------------------------------------------
// Dashboard & Stats (FR-03.1, FR-03.2)
// ---------------------------------------------------------------------------

export interface ActivityStats {
  total: number
  completed: number
  failed: number
  aborted: number
  running: number
  avgDurationSec: number | null  // completed only
  successRate: number | null     // completed / (completed + failed)
}

/**
 * Format activity as a structured dashboard for system prompt injection.
 * Separates running agents (with elapsed time) from recent completions.
 */
export function formatActivityDashboard(directory: string): string {
  const log = readActivityLog(directory)
  const running = log.entries.filter(e => e.status === "running")
  const recent = log.entries.filter(e => e.status !== "running").slice(-5)

  const lines: string[] = []

  if (running.length > 0) {
    lines.push("## Running Agents")
    for (const e of running) {
      const elapsed = Math.round((Date.now() - new Date(e.startedAt).getTime()) / 1000)
      const task = e.taskSummary.length > 50 ? e.taskSummary.slice(0, 47) + "..." : e.taskSummary
      lines.push(`- **${e.agentName}** [${elapsed}s] "${task}"`)
    }
  }

  if (recent.length > 0) {
    lines.push(running.length > 0 ? "\n## Recent Completions" : "## Recent Agent Activity")
    for (const e of recent) {
      const ago = formatTimeAgo(e.startedAt)
      const dur = e.durationSec !== null ? `${e.durationSec}s` : "?"
      lines.push(`- [${ago}] ${e.agentName}: ${e.status} (${dur})`)
    }
  }

  return lines.length > 0 ? lines.join("\n") : ""
}

/**
 * Get aggregate activity statistics for the session.
 */
export function getActivityStats(directory: string): ActivityStats {
  const log = readActivityLog(directory)
  const entries = log.entries

  const completed = entries.filter(e => e.status === "completed")
  const failed = entries.filter(e => e.status === "failed")
  const running = entries.filter(e => e.status === "running")
  const aborted = entries.filter(e => e.status === "aborted")

  const durations = completed.filter(e => e.durationSec !== null).map(e => e.durationSec!)
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null

  const finishedTotal = completed.length + failed.length
  const successRate = finishedTotal > 0
    ? Math.round((completed.length / finishedTotal) * 100)
    : null

  return {
    total: entries.length,
    completed: completed.length,
    failed: failed.length,
    aborted: aborted.length,
    running: running.length,
    avgDurationSec: avgDuration,
    successRate,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  return `${diffHr}h ago`
}
