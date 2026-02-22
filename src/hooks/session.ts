import type { PluginInput } from "@opencode-ai/plugin"
import { initPdcaStatusIfNotExists, recoverStatusFromDocs, syncStatusWithDocs } from "../lib/pdca/status"
import { detectLevel, autoDetectLevel, storeLevel } from "../lib/pdca/level"
import { debugLog } from "../lib/core/debug"
import { invalidateCache as invalidateMemoryCache, getMemory, setMemory, updateMemory } from "../lib/core/memory-store"
import { clearSessionContext, setSessionContext } from "../lib/context-hierarchy"
import { clearActiveContext } from "../lib/task/context"
import { clearAllForks } from "../lib/context-fork"
import { taskManager } from "../lib/task/background-manager"
import { updateTeammateStatus, readAgentState, cleanupAgentState, addRecentMessage } from "../lib/team/state-writer"
import { recordAgentCompletion } from "../lib/team/activity-log"
import { handleTeammateIdle } from "../lib/team/coordinator"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

/**
 * Event hook handler for session lifecycle.
 *
 * OpenCode event hook: (input: { event: Event }) => Promise<void>
 * Event is a union type; we handle "session.created", "session.deleted",
 * and "session.status" (for agent completion detection).
 */
export function createSessionHandler(input: PluginInput) {
  return async ({ event }: { event: { type: string; properties?: any } }) => {
    // Handle session.status events for agent completion detection (FR-01)
    // Two paths:
    //   1. Sync mode: resolve the pending Promise in BackgroundTaskManager
    //   2. Async mode: look up session registry and update teammate status directly
    if (event.type === "session.status") {
      try {
        const props = event.properties as { sessionID?: string; status?: { type?: string } } | undefined
        if (props?.status?.type === "idle" && props.sessionID) {
          // Path 1: Sync mode — resolve pending Promise
          const wasTracked = taskManager.handleSessionIdle(props.sessionID)
          if (wasTracked) {
            debugLog("Session", "Child session idle — resolved via event (sync)", {
              sessionID: props.sessionID,
              pendingCount: taskManager.pendingCount,
            })
          }

          // Path 2: Async mode — check session registry for untracked sessions
          // If handleSessionIdle returned false, this session wasn't awaited via Promise.race.
          // But it might be a background agent we should mark as completed.
          if (!wasTracked) {
            const agentName = taskManager.getAgentForSession(props.sessionID)
            if (agentName) {
              try {
                // Output validation: verify session has actual assistant output
                // before marking as completed. Prevents premature completion for
                // sessions that briefly go idle during initialization.
                let hasOutput = false
                try {
                  const msgsResult = await input.client.session.messages({
                    path: { id: props.sessionID },
                  })
                  if (!msgsResult.error && Array.isArray(msgsResult.data)) {
                    hasOutput = (msgsResult.data as any[]).some((m: any) =>
                      m.info?.role === "assistant" &&
                      m.parts?.some((p: any) =>
                        (p.type === "text" || p.type === "reasoning") &&
                        (p.text ?? "").trim().length > 0
                      )
                    )
                  }
                } catch {
                  // If message fetch fails, assume output exists (conservative)
                  hasOutput = true
                }

                if (!hasOutput) {
                  debugLog("Session", "Async agent idle but no output — deferring completion", {
                    sessionID: props.sessionID,
                    agentName,
                  })
                  // Don't mark completed or unregister; delegate-result polling will handle it
                  return
                }

                const state = readAgentState(input.directory)
                if (state?.enabled) {
                  const teammate = state.teammates.find(t => t.name === agentName)
                  if (teammate && (teammate.status === "spawning" || teammate.status === "working")) {
                    updateTeammateStatus(agentName, "completed", null, input.directory)
                    recordAgentCompletion(input.directory, props.sessionID, "completed")
                    debugLog("Session", "Async agent completed via event (output validated)", {
                      sessionID: props.sessionID,
                      agentName,
                      previousStatus: teammate.status,
                    })

                    // FR-03: Activate coordinator — suggest next task to CTO-Lead
                    try {
                      const pdcaStatusPath = join(input.directory, "docs", ".pdca-status.json")
                      if (existsSync(pdcaStatusPath)) {
                        const pdcaData = JSON.parse(readFileSync(pdcaStatusPath, "utf8"))
                        const primaryFeature = pdcaData?.primaryFeature
                        const featureData = primaryFeature ? pdcaData?.features?.[primaryFeature] : null
                        if (featureData) {
                          const idleResult = handleTeammateIdle(
                            agentName,
                            { feature: primaryFeature, phase: featureData.phase },
                            input.directory,
                          )
                          if (idleResult?.nextTask) {
                            addRecentMessage({
                              from: "system",
                              to: "cto-lead",
                              content: `Agent "${agentName}" completed. Next available task: "${idleResult.nextTask.description}" (${idleResult.nextTask.roleName})`,
                            }, input.directory)
                            debugLog("Session", "Coordinator suggested next task", {
                              teammate: agentName,
                              nextTask: idleResult.nextTask.description,
                            })
                          }
                        }
                      }
                    } catch (e: any) {
                      debugLog("Session", "handleTeammateIdle error (non-fatal)", { error: e?.message })
                    }
                  }
                }
              } catch (e: any) {
                debugLog("Session", "Async teammate update error (non-fatal)", { error: e.message })
              }
              taskManager.unregisterSession(props.sessionID)
            }
          }
        }
      } catch (e: any) {
        debugLog("Session", "session.status handler error (non-fatal)", { error: e.message })
      }
      return
    }

    if (event.type === "session.created") {
      try {
        // Initialize memory store (clear stale cache from previous session)
        invalidateMemoryCache()

        // C1: Hydrate BackgroundTaskManager session registry from disk
        taskManager.hydrateFromDisk(input.directory)

        let level: string | null = detectLevel(input.directory)

        // If no stored level, auto-detect for visibility only.
        // Don't auto-store — let the system prompt ask the user to confirm.
        if (!level) {
          const detected = autoDetectLevel(input.directory)
          debugLog("Session", "No stored level, auto-detected", { detected })
        }

        // Re-read level after memory cache invalidation (picks up
        // projectLevel from .bkit-memory.json written by previous session)
        level = detectLevel(input.directory)
        const autoDetected = autoDetectLevel(input.directory)

        // Update session tracking FIRST — creates docs/ directory.
        // Must run BEFORE initPdcaStatusIfNotExists so that docs/ exists
        // (fixes chicken-and-egg: new projects had no markers → init skipped).
        const prevCount = (getMemory<number>("sessionCount") ?? 0)
        updateMemory({
          sessionCount: prevCount + 1,
          lastSession: {
            startedAt: new Date().toISOString(),
            platform: "opencode",
            level: level ?? `unset (auto-detected: ${autoDetected})`,
          },
        })

        // Recovery: if PDCA docs exist but .pdca-status.json doesn't,
        // reconstruct status from the existing documents.
        // Must run BEFORE initPdcaStatusIfNotExists, which creates an empty file
        // and would cause recoverStatusFromDocs to bail out.
        await recoverStatusFromDocs(input.directory)

        await initPdcaStatusIfNotExists(input.directory)

        // Sync: pick up docs not tracked in status (e.g. created via bash)
        await syncStatusWithDocs(input.directory)

        // Initialize session context with session metadata
        clearSessionContext()
        setSessionContext("sessionStartedAt", new Date().toISOString())
        if (level) setSessionContext("projectLevel", level)

        debugLog("Session", "bkit initialized", { level, directory: input.directory })
      } catch (e: any) {
        debugLog("Session", "Init error (non-fatal)", { error: e.message })
      }
    }

    if (event.type === "session.deleted") {
      try {
        const state = readAgentState(input.directory)
        if (state?.enabled) {
          cleanupAgentState(input.directory)
          debugLog("Session", "Team state cleaned up")
        }

        // Clear session-scoped state
        clearSessionContext()
        clearActiveContext()
        clearAllForks()
      } catch (e: any) {
        debugLog("Session", "Cleanup error (non-fatal)", { error: e.message })
      }
    }
  }
}
