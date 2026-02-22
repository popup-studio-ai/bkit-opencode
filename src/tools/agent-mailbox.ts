/**
 * bkit Agent Mailbox Tool (registered as "bkit-agent-mailbox")
 *
 * Inter-agent messaging via file-based mailbox.
 * Actions: send (to agent), receive (my unread), list (all mailboxes).
 */

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { sendMessage, getUnread, markAllRead, listMailboxSummary } from "../lib/team/mailbox"

export function createAgentMailboxTool(input: PluginInput) {
  return tool({
    description:
      "Inter-agent mailbox for sending and receiving messages between agents. Use 'send' to message another agent, 'receive' to check your unread messages, 'list' to see all mailbox statuses.",
    args: {
      action: tool.schema
        .enum(["send", "receive", "list"])
        .describe("Mailbox action: send, receive, or list"),
      to: tool.schema
        .string()
        .optional()
        .describe("Target agent name (required for send)"),
      content: tool.schema
        .string()
        .optional()
        .describe("Message content (required for send, max 500 chars)"),
    },
    async execute(args, ctx) {
      const directory = ctx.directory

      switch (args.action) {
        case "send": {
          if (!args.to) return "Error: 'to' is required for send action."
          if (!args.content) return "Error: 'content' is required for send action."

          // Validate target agent exists
          const KNOWN_AGENTS = [
            "cto-lead", "product-manager", "frontend-architect", "security-architect",
            "enterprise-expert", "infra-architect", "backend-expert", "baas-expert",
            "design-validator", "gap-detector", "code-analyzer", "qa-strategist",
            "qa-monitor", "pdca-iterator", "report-generator", "pipeline-guide",
            "starter-guide",
          ]
          if (!KNOWN_AGENTS.includes(args.to)) {
            return `Error: Unknown agent "${args.to}".\nKnown agents: ${KNOWN_AGENTS.join(", ")}`
          }

          const from = (ctx as any).agent ?? "user"
          sendMessage(directory, from, args.to, args.content)
          return `Message sent to "${args.to}" from "${from}".`
        }

        case "receive": {
          const agent = (ctx as any).agent
          if (!agent) return "Error: Cannot determine your agent name. Use 'list' to see all mailboxes."

          const unread = getUnread(directory, agent)
          if (unread.length === 0) return "No unread messages."

          markAllRead(directory, agent)

          const lines = [`# Unread Messages for ${agent} (${unread.length})`, ""]
          for (const msg of unread) {
            lines.push(`- **[${msg.from}]** (${msg.timestamp.slice(0, 19)}): ${msg.content}`)
          }
          return lines.join("\n")
        }

        case "list": {
          const summaries = listMailboxSummary(directory)
          if (summaries.length === 0) return "No mailboxes found."

          const lines = ["# Mailbox Summary", ""]
          lines.push("| Agent | Total | Unread |")
          lines.push("|-------|-------|--------|")
          for (const s of summaries) {
            lines.push(`| ${s.agent} | ${s.total} | ${s.unread} |`)
          }
          return lines.join("\n")
        }

        default:
          return `Error: Unknown action "${args.action}". Use send, receive, or list.`
      }
    },
  })
}
