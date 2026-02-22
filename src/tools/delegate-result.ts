/**
 * bkit delegate-result Tool (registered as "agent_result")
 *
 * Checks status and retrieves results of background agent tasks
 * spawned by the agent tool with run_in_background=true.
 *
 * SDK migration (v2): Uses PluginInput.client instead of raw HTTP fetch(),
 * consistent with delegate-task.ts refactor.
 */

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { join } from "path"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs"
import { updateTeammateStatus, readAgentState } from "../lib/team/state-writer"
import { taskManager } from "../lib/task/background-manager"
import { recordAgentCompletion } from "../lib/team/activity-log"
import { taskDebugLog } from "../lib/task/http-debug"
import { formatTaskError } from "../lib/task/error-formatting"
import { AgentMessage, extractResultText } from "../lib/task/message-utils"

type SdkClient = PluginInput["client"]

// AgentMessage type imported from lib/task/message-utils

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

function debugLog(label: string, msg: string, data?: any): void {
  taskDebugLog("task-result", label, msg, data)
}

// ---------------------------------------------------------------------------
// SDK Helpers
// ---------------------------------------------------------------------------

/** Fetch all session statuses via SDK. */
async function fetchSessionStatuses(
  client: SdkClient, directory: string
): Promise<Record<string, { type: string }>> {
  try {
    const result = await client.session.status({ query: { directory } })
    if (result.error || !result.data) return {}
    return result.data as Record<string, { type: string }>
  } catch (e: any) {
    debugLog("status", `Failed to fetch statuses: ${e?.message}`)
    return {}
  }
}

/** Fetch messages for a session via SDK. */
async function fetchMessages(
  client: SdkClient, sessionID: string
): Promise<{ ok: boolean; data: AgentMessage[] }> {
  try {
    const result = await client.session.messages({ path: { id: sessionID } })
    if (result.error) {
      debugLog("messages", `SDK error for ${sessionID}`, { error: result.error })
      return { ok: false, data: [] }
    }
    return { ok: true, data: Array.isArray(result.data) ? result.data as AgentMessage[] : [] }
  } catch (e: any) {
    debugLog("messages", `Fetch failed for ${sessionID}`, { error: e?.message })
    return { ok: false, data: [] }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getOutputDir(directory: string): string {
  return join(directory, ".bkit", "agent-output")
}

/** Validate job ID format: 12-char hex or sync-prefixed hex */
function isValidJobId(jobId: string): boolean {
  return /^(sync-)?[0-9a-f]{12}$/.test(jobId)
}

function readJobOutput(directory: string, jobId: string): Record<string, any> | null {
  if (!isValidJobId(jobId)) return null
  const filePath = join(getOutputDir(directory), `${jobId}.json`)
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8"))
    }
  } catch (e: any) {
    debugLog("readJob", `Failed to read job ${jobId}: ${e?.message}`)
  }
  return null
}

function writeJobOutput(directory: string, jobId: string, data: Record<string, any>): void {
  if (!isValidJobId(jobId)) return
  const dir = getOutputDir(directory)
  if (!existsSync(dir)) return
  writeFileSync(join(dir, `${jobId}.json`), JSON.stringify(data, null, 2))
}

// extractResultText imported from lib/task/message-utils

export function createDelegateResultTool(input: PluginInput) {
  const client = input.client

  return tool({
    description:
      "Check status or retrieve result of a background agent task. Use job_id from agent tool output, or list_all=true to see all jobs.",
    args: {
      job_id: tool.schema
        .string()
        .optional()
        .describe("Job ID returned by agent tool (background mode)"),
      list_all: tool.schema
        .boolean()
        .optional()
        .describe("Set to true to list all agent jobs with their status"),
    },
    async execute(args, ctx) {
      const directory = ctx.directory

      // List all jobs
      if (args.list_all) {
        const outputDir = getOutputDir(directory)
        if (!existsSync(outputDir)) {
          return "No agent jobs found."
        }

        const files = readdirSync(outputDir).filter(f => f.endsWith(".json"))
        if (files.length === 0) {
          return "No agent jobs found."
        }

        // Get live session statuses via SDK
        const liveStatuses = await fetchSessionStatuses(client, directory)

        const lines = ["# Agent Jobs", ""]
        for (const file of files.sort().reverse().slice(0, 20)) {
          const jobId = file.replace(".json", "")
          const data = readJobOutput(directory, jobId)
          if (!data) continue

          const elapsed = data.startedAt
            ? Math.round((Date.now() - new Date(data.startedAt).getTime()) / 1000)
            : null

          // Enrich running jobs with live status
          let status = data.status
          if (status === "running" && data.sessionId && liveStatuses[data.sessionId]) {
            const live = liveStatuses[data.sessionId].type
            if (live === "idle") status = "likely_completed"
          }

          const elapsedStr = elapsed !== null ? ` (${elapsed}s)` : ""
          lines.push(`- **${jobId}**: ${data.agent ?? "?"} — ${status}${elapsedStr}`)
        }

        lines.push("", `Total: ${files.length} jobs`)
        return lines.join("\n")
      }

      // Single job check
      if (!args.job_id) {
        return "Error: Provide job_id to check a specific job, or set list_all=true to see all jobs."
      }

      const data = readJobOutput(directory, args.job_id)
      if (!data) {
        return `Error: No job found with id "${args.job_id}"`
      }

      // Already completed/failed/timeout — return cached result
      if (data.status !== "running") {
        const elapsed = data.startedAt && data.completedAt
          ? Math.round((new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime()) / 1000)
          : null

        return [
          `# Job: ${args.job_id}`,
          "",
          `**Agent:** ${data.agent}`,
          `**Status:** ${data.status}`,
          elapsed !== null ? `**Duration:** ${elapsed}s` : null,
          data.error ? `**Error:** ${data.error}` : null,
          data.output ? `\n---\n\n${data.output}` : null,
          data.sessionId ? `\nsession_id: ${data.sessionId}` : null,
        ].filter(Boolean).join("\n")
      }

      // Job is running — check live session status
      if (!data.sessionId) {
        return `Job ${args.job_id} is running but has no session ID. This may indicate a spawn failure.`
      }

      // Check if session is idle (completed) via SDK with retry to guard against false idle
      const MAX_IDLE_CHECKS = 3
      const IDLE_CHECK_DELAY_MS = 1500
      let sessionIdle = false
      try {
        const liveStatuses = await fetchSessionStatuses(client, directory)
        const sessionStatus = liveStatuses[data.sessionId]
        const firstCheck = !sessionStatus || sessionStatus.type === "idle"
        debugLog("status", `session ${data.sessionId}: ${sessionStatus ? JSON.stringify(sessionStatus) : "not_found"} → idle=${firstCheck}`)

        if (firstCheck) {
          // Confirm idle with retries to avoid false positives
          let confirmedCount = 1
          for (let i = 1; i < MAX_IDLE_CHECKS; i++) {
            await new Promise(resolve => setTimeout(resolve, IDLE_CHECK_DELAY_MS))
            const recheckStatuses = await fetchSessionStatuses(client, directory)
            const recheckStatus = recheckStatuses[data.sessionId]
            if (!recheckStatus || recheckStatus.type === "idle") {
              confirmedCount++
            } else {
              debugLog("status", `False idle detected on recheck ${i}: ${recheckStatus.type}`)
              break
            }
          }
          sessionIdle = confirmedCount >= MAX_IDLE_CHECKS
          debugLog("status", `Idle confirmation: ${confirmedCount}/${MAX_IDLE_CHECKS} → sessionIdle=${sessionIdle}`)
        }
      } catch (e: any) {
        debugLog("status", `Failed to check session status: ${e?.message}`)
      }

      if (!sessionIdle) {
        const elapsed = data.startedAt
          ? Math.round((Date.now() - new Date(data.startedAt).getTime()) / 1000)
          : null

        // Fetch intermediate progress from child session messages
        let progress = ""
        try {
          const msgsResult = await fetchMessages(client, data.sessionId)
          debugLog("progress", `messages response: ok=${msgsResult.ok}, length=${msgsResult.data.length}`)
          if (msgsResult.ok) {
            const msgs = msgsResult.data
            const assistantMsgs = msgs.filter(m => m.info?.role === "assistant")

            // Extract tool usage from all messages
            const toolParts = msgs.flatMap(m =>
              (m.parts ?? []).filter(p => p.type === "tool")
            )
            const toolNames = toolParts.map(p => p.tool ?? "unknown")
            const completedTools = toolParts.filter(p => p.state?.status === "completed")
            const runningTools = toolParts.filter(p => p.state?.status === "running")

            // Extract step-finish parts for token/cost info
            const stepFinishes = msgs.flatMap(m =>
              (m.parts ?? []).filter(p => p.type === "step-finish")
            )

            // Get latest text output
            const allText = msgs.flatMap(m =>
              (m.parts ?? []).filter(p => p.type === "text" && m.info?.role === "assistant")
                .map(p => p.text ?? "")
            ).filter(Boolean)

            const lines: string[] = []

            if (toolNames.length > 0) {
              const uniqueTools = [...new Set(toolNames)]
              lines.push(`**Tools:** ${completedTools.length} completed, ${runningTools.length} running (${uniqueTools.join(", ")})`)
            }

            if (runningTools.length > 0) {
              const current = runningTools[runningTools.length - 1]
              const title = current.state?.title ?? current.tool ?? "working"
              lines.push(`**Currently:** ${title}`)
            }

            lines.push(`**Steps:** ${stepFinishes.length} completed, ${assistantMsgs.length} assistant turns`)

            if (allText.length > 0) {
              const lastText = allText[allText.length - 1]
              const preview = lastText.length > 500 ? lastText.slice(-500) : lastText
              lines.push("", "**Latest output:**", preview)
            }

            progress = lines.join("\n")
          }
        } catch (e: any) {
          debugLog("progress", `Error fetching progress: ${e.message}`)
        }

        return [
          `# Job: ${args.job_id}`,
          "",
          `**Agent:** ${data.agent}`,
          `**Status:** running`,
          elapsed !== null ? `**Elapsed:** ${elapsed}s` : null,
          `**Session:** ${data.sessionId}`,
          "",
          progress || "Agent is working. No output yet. Use agent_result again in a few seconds.",
        ].filter(Boolean).join("\n")
      }

      // Session is idle — fetch result via SDK
      try {
        const msgsResult = await fetchMessages(client, data.sessionId)
        debugLog("idle-result", `messages: ok=${msgsResult.ok}, length=${msgsResult.data.length}`)
        if (!msgsResult.ok) {
          return formatTaskError(
            new Error("Failed to fetch session messages"),
            { operation: "Result fetch", sessionID: data.sessionId, agent: data.agent },
          )
        }
        const msgs = msgsResult.data
        const result = extractResultText(msgs)
        debugLog("idle-result", `extractResultText: ${result.slice(0, 200)}`)
        const elapsed = data.startedAt
          ? Math.round((Date.now() - new Date(data.startedAt).getTime()) / 1000)
          : null

        // Update job file with completed status
        writeJobOutput(directory, args.job_id, {
          ...data,
          status: "completed",
          output: result.slice(0, 10000),
          duration: elapsed ? elapsed * 1000 : undefined,
          completedAt: new Date().toISOString(),
        })

        // Record in unified activity log (idempotent — event path may have already recorded)
        if (data.sessionId) {
          recordAgentCompletion(directory, data.sessionId, "completed", result.slice(0, 200))
        }

        // Sync teammate state: mark agent as completed
        if (data.agent) {
          try {
            const agentState = readAgentState(directory)
            if (agentState?.enabled) {
              updateTeammateStatus(data.agent, "completed", null, directory)
              debugLog("result", `Teammate "${data.agent}" marked completed`)
            }
          } catch (e: any) {
            debugLog("result", `Failed to update teammate state: ${e?.message}`)
          }
          // Clean up session registry
          if (data.sessionId) taskManager.unregisterSession(data.sessionId)
        }

        return [
          `# Job: ${args.job_id}`,
          "",
          `**Agent:** ${data.agent}`,
          `**Status:** completed`,
          elapsed !== null ? `**Duration:** ${elapsed}s` : null,
          "",
          "---",
          "",
          result,
          "",
          `session_id: ${data.sessionId}`,
        ].filter(Boolean).join("\n")
      } catch (e: any) {
        return formatTaskError(e, { operation: "Result fetch", sessionID: data.sessionId, agent: data.agent })
      }
    },
  })
}
