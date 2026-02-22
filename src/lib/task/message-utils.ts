/**
 * Shared message types and utilities for agent session processing.
 *
 * Used by both delegate-task (sync) and delegate-result (background)
 * to parse and extract text from agent session messages.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Message shape returned by client.session.messages() */
export type AgentMessage = {
  info?: {
    role?: string
    finish?: string
    id?: string
    time?: { created?: number; completed?: number }
  }
  parts?: Array<{
    type?: string
    text?: string
    tool?: string
    state?: { status?: string; title?: string; input?: Record<string, any> }
  }>
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the last assistant's text output from session messages.
 *
 * @param messages - Array of session messages
 * @param afterIndex - When > 0, only considers messages after that index
 *   (for continuation sessions where we only want NEW responses)
 */
export function extractResultText(messages: AgentMessage[], afterIndex: number = 0): string {
  const relevantMessages = afterIndex > 0 ? messages.slice(afterIndex) : messages
  const assistants = relevantMessages
    .filter(m => m.info?.role === "assistant")
    .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))

  const last = assistants[0]
  if (!last) return "(No assistant response)"

  const textParts = last.parts?.filter(p => p.type === "text" || p.type === "reasoning") ?? []
  return textParts.map(p => p.text ?? "").filter(Boolean).join("\n") || "(Empty response)"
}
