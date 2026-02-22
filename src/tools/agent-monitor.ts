/**
 * bkit Agent Monitor Tool (registered as "bkit-agent-monitor")
 *
 * Real-time overview of all running agents, mailbox statuses,
 * and recent completions. Uses session registry + activity log + mailbox.
 */

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { taskManager } from "../lib/task/background-manager"
import { queryActivity, getActivityStats } from "../lib/team/activity-log"
import { listMailboxSummary } from "../lib/team/mailbox"
import { readAgentState } from "../lib/team/state-writer"

type SdkClient = PluginInput["client"]

function formatTimeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  return `${diffHr}h ago`
}

export function createAgentMonitorTool(input: PluginInput) {
  const client = input.client

  return tool({
    description:
      "Show real-time status of all running agents, mailbox summary, and recent completions. Use inspect parameter to see what a specific agent is actually doing (last messages and tool calls).",
    args: {
      inspect: tool.schema.string().optional().describe(
        "Agent name to inspect. Shows the agent's last session messages so you can see exactly what it's working on. Example: inspect='frontend-architect'"
      ),
    },
    async execute(_args, ctx) {
      const directory = ctx.directory
      const lines: string[] = []
      const now = new Date()

      lines.push(`# Agent Monitor (${now.toISOString().slice(0, 19)})`)
      lines.push("")

      // 1. Running agents from session registry
      const sessions = taskManager.getRegisteredSessions()

      if (sessions.length === 0) {
        lines.push("## Running Agents: None")
      } else {
        lines.push(`## Running Agents (${sessions.length})`)
        lines.push("")
        lines.push("| Agent | Session | Status | Duration | Last Tool |")
        lines.push("|-------|---------|--------|----------|-----------|")

        // Fetch all session statuses in one call
        let liveStatuses: Record<string, { type?: string }> = {}
        try {
          const statusResult = await client.session.status({ query: { directory } })
          if (!statusResult.error && statusResult.data) {
            liveStatuses = statusResult.data as Record<string, { type?: string }>
          }
        } catch { /* non-fatal */ }

        for (const { sessionId, agentName } of sessions) {
          const liveStatus = liveStatuses[sessionId]
          const status = liveStatus?.type ?? "unknown"

          // Get duration from activity log
          let duration = "?"
          const activities = queryActivity(directory, { agent: agentName, status: "running", last: 1 })
          if (activities.length > 0) {
            const elapsed = Math.round((Date.now() - new Date(activities[0].startedAt).getTime()) / 1000)
            duration = `${elapsed}s`
          }

          // Get last tool from session messages (expensive — limited to running sessions)
          let lastTool = "..."
          try {
            const msgsResult = await client.session.messages({ path: { id: sessionId } })
            if (!msgsResult.error && Array.isArray(msgsResult.data)) {
              const toolParts = (msgsResult.data as any[]).flatMap((m: any) =>
                (m.parts ?? []).filter((p: any) => p.type === "tool")
              )
              if (toolParts.length > 0) {
                const last = toolParts[toolParts.length - 1]
                lastTool = `${last.tool ?? "?"} (${toolParts.length} total)`
              }
            }
          } catch { /* non-fatal */ }

          lines.push(`| ${agentName} | ${sessionId.slice(0, 8)}... | ${status} | ${duration} | ${lastTool} |`)
        }
      }

      // 2. Team state (if active)
      const teamState = readAgentState(directory)
      if (teamState?.enabled) {
        lines.push("")
        lines.push("## Team State")
        lines.push(`- Feature: ${teamState.feature}`)
        lines.push(`- Phase: ${teamState.pdcaPhase}`)
        lines.push(`- Pattern: ${teamState.orchestrationPattern}`)
        lines.push(`- Teammates: ${teamState.teammates.length}`)
        if (teamState.teammates.length > 0) {
          for (const t of teamState.teammates) {
            lines.push(`  - ${t.name}: ${t.status}${t.currentTask ? ` (${t.currentTask.slice(0, 50)})` : ""}`)
          }
        }
      }

      // 3. Mailbox summary
      const mailboxes = listMailboxSummary(directory)
      if (mailboxes.length > 0) {
        lines.push("")
        lines.push("## Mailbox Summary")
        for (const mb of mailboxes) {
          const unreadLabel = mb.unread > 0 ? ` (${mb.unread} unread)` : ""
          lines.push(`- ${mb.agent}: ${mb.total} messages${unreadLabel}`)
        }
      }

      // 4. Recent completions (last 5)
      const allRecent = queryActivity(directory, { last: 10 })
      const completions = allRecent.filter(e => e.status !== "running").slice(-5)
      if (completions.length > 0) {
        lines.push("")
        lines.push("## Recent Completions")
        for (const e of completions) {
          const ago = formatTimeAgo(e.completedAt || e.startedAt)
          lines.push(`- [${ago}] ${e.agentName}: ${e.status} (${e.durationSec ?? "?"}s)`)
        }
      }

      // 5. Session stats
      const stats = getActivityStats(directory)
      if (stats.total > 0) {
        lines.push("")
        lines.push("## Session Stats")
        lines.push(`- Total: ${stats.total} | Completed: ${stats.completed} | Failed: ${stats.failed} | Running: ${stats.running}`)
        if (stats.avgDurationSec !== null) {
          lines.push(`- Avg Duration: ${stats.avgDurationSec}s | Success Rate: ${stats.successRate ?? "N/A"}%`)
        }
      }

      // 6. Inspect: deep-dive into a specific agent's session messages
      if (_args.inspect) {
        const targetAgent = _args.inspect.trim().toLowerCase()
        const match = sessions.find(s => s.agentName.toLowerCase() === targetAgent)

        lines.push("")
        if (!match) {
          lines.push(`## Inspect: "${_args.inspect}" — not found in running sessions`)
          const available = sessions.map(s => s.agentName).join(", ")
          lines.push(available ? `Running agents: ${available}` : "No agents currently running.")
        } else {
          lines.push(`## Inspect: ${match.agentName} (${match.sessionId.slice(0, 12)}...)`)
          lines.push("")

          try {
            const msgsResult = await client.session.messages({ path: { id: match.sessionId } })
            if (msgsResult.error || !Array.isArray(msgsResult.data)) {
              lines.push("(Failed to fetch session messages)")
            } else {
              const msgs = msgsResult.data as any[]

              // Recent tool calls (last 5)
              const toolParts = msgs.flatMap((m: any) =>
                (m.parts ?? []).filter((p: any) => p.type === "tool").map((p: any) => ({
                  tool: p.tool ?? "unknown",
                  status: p.state?.status ?? "?",
                  title: p.state?.title ?? "",
                }))
              )
              if (toolParts.length > 0) {
                const recent = toolParts.slice(-5)
                lines.push(`### Recent Tools (${toolParts.length} total, showing last ${recent.length})`)
                for (const t of recent) {
                  lines.push(`- ${t.tool} [${t.status}]${t.title ? ` — ${t.title.slice(0, 80)}` : ""}`)
                }
                lines.push("")
              }

              // Last assistant message content
              const assistants = msgs.filter((m: any) => m.info?.role === "assistant")
              const last = assistants[assistants.length - 1]
              if (last) {
                const textParts = (last.parts ?? [])
                  .filter((p: any) => p.type === "text" || p.type === "reasoning")
                  .map((p: any) => p.text ?? "")
                  .filter(Boolean)
                const content = textParts.join("\n")
                if (content) {
                  lines.push("### Last Assistant Response (preview)")
                  lines.push("```")
                  lines.push(content.slice(0, 1000) + (content.length > 1000 ? "\n... (truncated)" : ""))
                  lines.push("```")
                } else {
                  lines.push("### Last Assistant Response: (no text — may be generating or using tools)")
                }
              } else {
                lines.push("(No assistant messages yet — agent may still be initializing)")
              }
            }
          } catch (e: any) {
            lines.push(`(Inspect failed: ${e?.message ?? "unknown error"})`)
          }
        }
      }

      return lines.join("\n")
    },
  })
}
