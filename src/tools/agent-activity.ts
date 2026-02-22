/**
 * bkit agent-activity Tool (registered as "bkit-agent-activity")
 *
 * Queries the unified agent activity log with optional filters.
 * Displays agent invocation history in a compact markdown format.
 */

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { queryActivity } from "../lib/team/activity-log"

export function createAgentActivityTool(input: PluginInput) {
  return tool({
    description:
      "Browse agent activity history. Filter by agent name, status, mode, or count. Shows when agents ran, what they did, and their results.",
    args: {
      agent: tool.schema
        .string()
        .optional()
        .describe("Filter by agent name (partial match, e.g. 'gap' matches 'gap-detector')"),
      status: tool.schema
        .enum(["running", "completed", "failed", "aborted", "timeout"])
        .optional()
        .describe("Filter by status"),
      mode: tool.schema
        .enum(["sync", "background"])
        .optional()
        .describe("Filter by execution mode"),
      last: tool.schema
        .number()
        .optional()
        .describe("Number of entries to return (default 20, max 100)"),
    },
    async execute(args, ctx) {
      const entries = queryActivity(ctx.directory, {
        agent: args.agent,
        status: args.status as any,
        mode: args.mode as any,
        last: args.last,
      })

      if (entries.length === 0) {
        const hasFilters = args.agent || args.status || args.mode
        return hasFilters
          ? "No agent activity matches the given filters."
          : "No agent activity recorded yet."
      }

      const lines = ["# Agent Activity Log", ""]
      for (const e of entries.slice().reverse()) {
        const dur = e.durationSec !== null ? `${e.durationSec}s` : "—"
        const result = e.resultSummary
          ? `\n  Result: ${e.resultSummary}`
          : ""
        const cont = e.continuation ? " (continuation)" : ""
        lines.push(
          `- **${e.agentName}** [${e.mode}${cont}] — ${e.status} (${dur})`,
          `  Task: ${e.taskSummary}`,
          `  Started: ${e.startedAt}${e.completedAt ? ` | Completed: ${e.completedAt}` : ""}`,
          `  ID: ${e.id} | Session: ${e.sessionId}${result}`,
          "",
        )
      }

      lines.push(`Total: ${entries.length} entries`)
      return lines.join("\n")
    },
  })
}
