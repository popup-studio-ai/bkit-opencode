/**
 * Structured error formatting for delegate-task / delegate-result.
 *
 * Replaces ad-hoc "Error: ..." strings with contextual, debuggable output.
 */

export interface TaskErrorContext {
  operation: string
  sessionID?: string
  agent?: string
  task?: string
}

/**
 * Format an error with detailed context for debugging.
 * Returns a markdown-formatted string suitable for tool output.
 */
export function formatTaskError(error: unknown, ctx: TaskErrorContext): string {
  const message = error instanceof Error ? error.message : String(error)

  const lines: string[] = [`${ctx.operation} failed`, "", `**Error**: ${message}`]

  if (ctx.sessionID) lines.push(`**Session**: ${ctx.sessionID}`)
  if (ctx.agent) lines.push(`**Agent**: ${ctx.agent}`)
  if (ctx.task) lines.push(`**Task**: ${ctx.task.slice(0, 200)}`)

  if (error instanceof Error && error.stack) {
    lines.push("", "```", ...error.stack.split("\n").slice(0, 5), "```")
  }

  return lines.join("\n")
}
