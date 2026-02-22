/**
 * BackgroundTaskManager — Event-based agent completion detection.
 *
 * Bridges OpenCode Bus events (session.status) with delegate-task Promises.
 * When a child session is spawned, delegate-task registers a pending entry
 * via waitForIdle(). When the event hook receives session.status {type:"idle"}
 * for that session, the pending Promise resolves instantly.
 *
 * C1: Dual persistence — session registry is kept in-memory AND on disk
 * (.bkit/agent-sessions.json). In-memory is fast for runtime lookups;
 * disk persists across process restarts.
 *
 * Usage:
 *   // In delegate-task.ts (BEFORE sending prompt_async):
 *   const idle = taskManager.waitForIdle(sessionId, timeoutMs)
 *   await httpPost(prompt_async)
 *   await idle  // resolves via event or timeout
 *
 *   // In session.ts event hook:
 *   taskManager.handleSessionIdle(sessionId)
 */

import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs"
import { debugLog } from "../core/debug"

interface PendingTask {
  resolve: () => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
  registeredAt: number
}

interface SessionRecord {
  agentName: string
  registeredAt: string
}

interface SessionsFile {
  sessions: Record<string, SessionRecord>
}

class BackgroundTaskManager {
  private pending = new Map<string, PendingTask>()
  /** Session registry: sessionId → agentName (for event-driven teammate updates) */
  private sessions = new Map<string, string>()
  /** Project directory — set once on init for disk persistence. */
  private directory: string | null = null
  private static instance: BackgroundTaskManager | null = null

  static getInstance(): BackgroundTaskManager {
    if (!BackgroundTaskManager.instance) {
      BackgroundTaskManager.instance = new BackgroundTaskManager()
    }
    return BackgroundTaskManager.instance
  }

  // -------------------------------------------------------------------------
  // Disk persistence helpers
  // -------------------------------------------------------------------------

  private getSessionsFilePath(): string | null {
    if (!this.directory) return null
    return join(this.directory, ".bkit", "agent-sessions.json")
  }

  /**
   * Set the project directory for disk persistence.
   * Call once during plugin initialization (session.created).
   */
  setDirectory(directory: string): void {
    this.directory = directory
  }

  /**
   * Restore session registry from disk file into in-memory Map.
   * Call on session.created to recover from process restarts.
   */
  hydrateFromDisk(directory: string): void {
    this.directory = directory
    const filePath = this.getSessionsFilePath()
    if (!filePath || !existsSync(filePath)) return

    try {
      const raw = readFileSync(filePath, "utf-8")
      const data: SessionsFile = JSON.parse(raw)
      if (data.sessions && typeof data.sessions === "object") {
        for (const [sessionId, record] of Object.entries(data.sessions)) {
          if (record.agentName && !this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, record.agentName)
          }
        }
        debugLog("TaskManager", "Hydrated from disk", {
          restored: Object.keys(data.sessions).length,
          totalSessions: this.sessions.size,
        })
      }
    } catch (e: any) {
      debugLog("TaskManager", "Hydrate failed (non-fatal)", { error: e.message })
    }
  }

  /**
   * Persist current session registry to disk.
   * Uses atomic write (write temp → rename) to prevent corruption.
   */
  private persistToDisk(): void {
    const filePath = this.getSessionsFilePath()
    if (!filePath) return

    try {
      const dir = join(this.directory!, ".bkit")
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

      const data: SessionsFile = { sessions: {} }
      for (const [sessionId, agentName] of this.sessions.entries()) {
        data.sessions[sessionId] = { agentName, registeredAt: new Date().toISOString() }
      }

      const tmpPath = filePath + ".tmp"
      writeFileSync(tmpPath, JSON.stringify(data, null, 2))
      renameSync(tmpPath, filePath)
    } catch (e: any) {
      debugLog("TaskManager", "Persist failed (non-fatal)", { error: e.message })
    }
  }

  // -------------------------------------------------------------------------
  // Pending (Promise-based) — in-memory only (Promises are not serializable)
  // -------------------------------------------------------------------------

  /**
   * Register a session to watch. Returns a Promise that resolves
   * when the session goes idle (via event) or rejects on timeout.
   *
   * IMPORTANT: Call this BEFORE sending prompt_async to prevent
   * race conditions where the event fires before registration.
   */
  waitForIdle(sessionId: string, timeoutMs: number = 1_800_000): Promise<void> {
    // If already tracked, silently remove the old entry (the old promise is abandoned)
    if (this.pending.has(sessionId)) {
      this.cleanup(sessionId)
    }

    return new Promise<void>((resolve, reject) => {
      const registeredAt = Date.now()

      const timer = setTimeout(() => {
        this.pending.delete(sessionId)
        debugLog("TaskManager", "Timeout waiting for idle", { sessionId, timeoutMs })
        reject(new Error(`Timeout waiting for session ${sessionId} after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(sessionId, {
        resolve: () => {
          clearTimeout(timer)
          this.pending.delete(sessionId)
          debugLog("TaskManager", "Resolved via event", {
            sessionId,
            waitedMs: Date.now() - registeredAt,
          })
          resolve()
        },
        reject: (err: Error) => {
          clearTimeout(timer)
          this.pending.delete(sessionId)
          reject(err)
        },
        timer,
        registeredAt,
      })
    })
  }

  /**
   * Called from event hook when session.status event fires with type "idle".
   * If the sessionId is tracked, resolves the pending Promise.
   *
   * @returns true if the session was tracked and resolved
   */
  handleSessionIdle(sessionId: string): boolean {
    const task = this.pending.get(sessionId)
    if (task) {
      task.resolve()
      return true
    }
    return false
  }

  /**
   * Cancel a pending wait — rejects the Promise so callers don't hang.
   * Use when someone is actively awaiting the promise (e.g., direct await).
   */
  cancel(sessionId: string): void {
    const task = this.pending.get(sessionId)
    if (task) {
      debugLog("TaskManager", "Cancelled", { sessionId })
      task.reject(new Error(`Cancelled: session ${sessionId}`))
    }
  }

  /**
   * Silently remove a pending entry without rejecting.
   * Use after Promise.race settles to clean up the losing promise
   * without causing unhandled rejections.
   */
  cleanup(sessionId: string): void {
    const task = this.pending.get(sessionId)
    if (task) {
      clearTimeout(task.timer)
      this.pending.delete(sessionId)
      debugLog("TaskManager", "Cleaned up", { sessionId })
    }
  }

  /** Check if a session is being tracked. */
  isTracked(sessionId: string): boolean {
    return this.pending.has(sessionId)
  }

  /** Number of sessions currently being tracked. */
  get pendingCount(): number {
    return this.pending.size
  }

  // -------------------------------------------------------------------------
  // Session Registry — maps sessionId → agentName for async lifecycle tracking
  // Dual persistence: in-memory Map + disk file
  // -------------------------------------------------------------------------

  /**
   * Register a child session so idle events can be mapped back to the agent.
   * Called by delegate-task for BOTH sync and async modes.
   * Writes to both in-memory Map and disk file.
   */
  registerSession(sessionId: string, agentName: string): void {
    this.sessions.set(sessionId, agentName)
    this.persistToDisk()
    debugLog("TaskManager", "Session registered", { sessionId, agentName, totalSessions: this.sessions.size })
  }

  /**
   * Look up which agent owns a session.
   * Used by session.ts event hook to update teammate status on idle.
   */
  getAgentForSession(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Remove a session from the registry (after completion/failure).
   * Removes from both in-memory Map and disk file.
   */
  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.persistToDisk()
    debugLog("TaskManager", "Session unregistered", { sessionId, totalSessions: this.sessions.size })
  }

  /** Number of registered sessions (for monitoring). */
  get sessionCount(): number {
    return this.sessions.size
  }

  /** Get all registered sessions (for monitoring/debugging). */
  getRegisteredSessions(): Array<{ sessionId: string; agentName: string }> {
    return Array.from(this.sessions.entries()).map(([sessionId, agentName]) => ({ sessionId, agentName }))
  }
}

export const taskManager = BackgroundTaskManager.getInstance()
