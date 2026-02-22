/**
 * Unit tests for delegate-task utility functions.
 *
 * Since the functions are module-private in delegate-task.ts, we re-implement
 * the same logic here. Tests verify the ALGORITHMS, not the module boundary.
 * Any change to the source functions should be reflected here.
 *
 * Run: npx vitest run src/tools/__tests__/delegate-task.test.ts
 */
import { describe, it, expect } from "vitest"
import { formatTaskError } from "../../lib/task/error-formatting"

// ---------------------------------------------------------------------------
// Re-implementations matching delegate-task.ts private functions
// ---------------------------------------------------------------------------

type AgentMessage = {
  info?: { role?: string; finish?: string; id?: string; time?: { created?: number; completed?: number } }
  parts?: Array<{ type?: string; text?: string }>
}

const PENDING_FINISH_REASONS = new Set(["tool-calls", "unknown"])

function isAgentSessionDone(messages: AgentMessage[]): boolean {
  let lastUser: AgentMessage | undefined
  let lastAssistant: AgentMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!lastAssistant && msg.info?.role === "assistant") lastAssistant = msg
    if (!lastUser && msg.info?.role === "user") lastUser = msg
    if (lastUser && lastAssistant) break
  }

  if (!lastAssistant?.info?.finish) return false
  if (PENDING_FINISH_REASONS.has(lastAssistant.info.finish)) return false
  if (!lastUser?.info?.id || !lastAssistant?.info?.id) return false
  return lastUser.info.id < lastAssistant.info.id
}

function extractResultText(messages: AgentMessage[], afterIndex: number = 0): string {
  const relevantMessages = afterIndex > 0 ? messages.slice(afterIndex) : messages
  const assistants = relevantMessages
    .filter(m => m.info?.role === "assistant")
    .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))

  const last = assistants[0]
  if (!last) return "(No assistant response)"

  const textParts = last.parts?.filter(p => p.type === "text" || p.type === "reasoning") ?? []
  return textParts.map(p => p.text ?? "").filter(Boolean).join("\n") || "(Empty response)"
}

function parseModelRef(model: string): { providerID: string; modelID: string } | undefined {
  const slash = model.indexOf("/")
  if (slash <= 0) return undefined
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}

// ---------------------------------------------------------------------------
// Tests: isAgentSessionDone
// ---------------------------------------------------------------------------

describe("isAgentSessionDone", () => {
  it("returns false for empty messages", () => {
    expect(isAgentSessionDone([])).toBe(false)
  })

  it("returns false when only assistant exists (no user)", () => {
    expect(isAgentSessionDone([
      { info: { role: "assistant", finish: "stop", id: "a1" } },
    ])).toBe(false)
  })

  it("returns false for non-terminal finish (tool-calls)", () => {
    expect(isAgentSessionDone([
      { info: { role: "user", id: "u1" } },
      { info: { role: "assistant", finish: "tool-calls", id: "a1" } },
    ])).toBe(false)
  })

  it("returns false for non-terminal finish (unknown)", () => {
    expect(isAgentSessionDone([
      { info: { role: "user", id: "u1" } },
      { info: { role: "assistant", finish: "unknown", id: "a1" } },
    ])).toBe(false)
  })

  it("returns true for terminal finish with user before assistant", () => {
    // IDs must be chronologically orderable via string comparison
    // "001" < "002" → assistant came after user → complete
    expect(isAgentSessionDone([
      { info: { role: "user", id: "001" } },
      { info: { role: "assistant", finish: "stop", id: "002" } },
    ])).toBe(true)
  })

  it("returns false when user.id > assistant.id (assistant came first)", () => {
    // "003" > "002" → user sent after last assistant → not complete
    expect(isAgentSessionDone([
      { info: { role: "assistant", finish: "stop", id: "002" } },
      { info: { role: "user", id: "003" } },
    ])).toBe(false)
  })

  it("returns true for end_turn finish", () => {
    expect(isAgentSessionDone([
      { info: { role: "user", id: "001" } },
      { info: { role: "assistant", finish: "end_turn", id: "002" } },
    ])).toBe(true)
  })

  it("returns false when assistant has no finish field", () => {
    expect(isAgentSessionDone([
      { info: { role: "user", id: "001" } },
      { info: { role: "assistant", id: "002" } },
    ])).toBe(false)
  })

  it("handles interleaved messages correctly", () => {
    // Multiple turns — should check the LAST user and LAST assistant
    expect(isAgentSessionDone([
      { info: { role: "user", id: "001" } },
      { info: { role: "assistant", finish: "tool-calls", id: "002" } },
      { info: { role: "user", id: "003" } },
      { info: { role: "assistant", finish: "stop", id: "004" } },
    ])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: extractResultText
// ---------------------------------------------------------------------------

describe("extractResultText", () => {
  it("returns '(No assistant response)' for empty messages", () => {
    expect(extractResultText([])).toBe("(No assistant response)")
  })

  it("extracts text from last assistant message", () => {
    const msgs: AgentMessage[] = [
      { info: { role: "user" } },
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [{ type: "text", text: "Hello world" }],
      },
    ]
    expect(extractResultText(msgs)).toBe("Hello world")
  })

  it("picks most recent assistant message", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [{ type: "text", text: "First response" }],
      },
      {
        info: { role: "assistant", time: { created: 200 } },
        parts: [{ type: "text", text: "Second response" }],
      },
    ]
    expect(extractResultText(msgs)).toBe("Second response")
  })

  it("includes reasoning parts", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [
          { type: "reasoning", text: "Let me think..." },
          { type: "text", text: "Answer: 42" },
        ],
      },
    ]
    expect(extractResultText(msgs)).toBe("Let me think...\nAnswer: 42")
  })

  it("returns '(Empty response)' when parts have no text", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [{ type: "tool" }],
      },
    ]
    expect(extractResultText(msgs)).toBe("(Empty response)")
  })

  it("respects afterIndex for continuation (C2)", () => {
    const msgs: AgentMessage[] = [
      // Old messages (before continuation)
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [{ type: "text", text: "Old response" }],
      },
      // New messages (after continuation)
      {
        info: { role: "user" } },
      {
        info: { role: "assistant", time: { created: 200 } },
        parts: [{ type: "text", text: "New response" }],
      },
    ]
    // afterIndex=1 means skip first message
    expect(extractResultText(msgs, 1)).toBe("New response")
    // afterIndex=0 (default) should get "New response" (most recent)
    expect(extractResultText(msgs, 0)).toBe("New response")
  })

  it("returns '(No assistant response)' when afterIndex excludes all assistants", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [{ type: "text", text: "Only response" }],
      },
    ]
    // afterIndex=1 skips the only assistant message
    expect(extractResultText(msgs, 1)).toBe("(No assistant response)")
  })
})

// ---------------------------------------------------------------------------
// Tests: parseModelRef
// ---------------------------------------------------------------------------

describe("parseModelRef", () => {
  it("parses valid provider/model string", () => {
    expect(parseModelRef("anthropic/claude-sonnet-4-5-20250929")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5-20250929",
    })
  })

  it("parses multi-slash model strings (first slash is the split)", () => {
    expect(parseModelRef("openrouter/deepseek/deepseek-v3.2")).toEqual({
      providerID: "openrouter",
      modelID: "deepseek/deepseek-v3.2",
    })
  })

  it("returns undefined for string without slash", () => {
    expect(parseModelRef("invalid")).toBeUndefined()
  })

  it("returns undefined for string starting with slash", () => {
    // slash at index 0 means empty provider
    expect(parseModelRef("/model")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(parseModelRef("")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Tests: formatTaskError (C6)
// ---------------------------------------------------------------------------

describe("formatTaskError", () => {
  it("formats basic error with operation name", () => {
    const result = formatTaskError("something broke", { operation: "Test" })
    expect(result).toContain("Test failed")
    expect(result).toContain("**Error**: something broke")
  })

  it("includes session and agent context", () => {
    const result = formatTaskError(new Error("oops"), {
      operation: "Prompt",
      sessionID: "sess-123",
      agent: "gap-detector",
    })
    expect(result).toContain("**Session**: sess-123")
    expect(result).toContain("**Agent**: gap-detector")
  })

  it("truncates long task to 200 chars", () => {
    const longTask = "a".repeat(300)
    const result = formatTaskError("err", {
      operation: "Test",
      task: longTask,
    })
    expect(result).toContain("**Task**: " + "a".repeat(200))
    expect(result).not.toContain("a".repeat(201))
  })

  it("includes stack trace for Error instances", () => {
    const err = new Error("test error")
    const result = formatTaskError(err, { operation: "Test" })
    expect(result).toContain("```")
    expect(result).toContain("Error: test error")
  })

  it("handles non-Error values", () => {
    const result = formatTaskError(42, { operation: "Test" })
    expect(result).toContain("**Error**: 42")
    expect(result).not.toContain("```") // No stack trace
  })
})

// ---------------------------------------------------------------------------
// Tests: Self-delegation prevention (C4)
// ---------------------------------------------------------------------------

describe("self-delegation prevention", () => {
  // Testing the logic pattern — actual tool execution requires SDK mocks
  it("detects same-agent self-delegation", () => {
    const callerAgent = "gap-detector"
    const targetAgent = "gap-detector"
    const isSelfDelegation = callerAgent.toLowerCase() === targetAgent.toLowerCase()
    expect(isSelfDelegation).toBe(true)
  })

  it("is case-insensitive", () => {
    const callerAgent = "CTO-Lead"
    const targetAgent = "cto-lead"
    const isSelfDelegation = callerAgent.toLowerCase() === targetAgent.toLowerCase()
    expect(isSelfDelegation).toBe(true)
  })

  it("allows different agents", () => {
    const callerAgent = "cto-lead"
    const targetAgent = "gap-detector"
    const isSelfDelegation = callerAgent.toLowerCase() === targetAgent.toLowerCase()
    expect(isSelfDelegation).toBe(false)
  })

  it("detects orchestrator-to-orchestrator delegation", () => {
    const ORCHESTRATOR_AGENTS = new Set(["cto-lead"])
    const callerAgent = "cto-lead"
    const targetAgent = "cto-lead"
    const blocked = ORCHESTRATOR_AGENTS.has(callerAgent) && ORCHESTRATOR_AGENTS.has(targetAgent)
    expect(blocked).toBe(true)
  })

  it("allows orchestrator to non-orchestrator", () => {
    const ORCHESTRATOR_AGENTS = new Set(["cto-lead"])
    const callerAgent = "cto-lead"
    const targetAgent = "gap-detector"
    const blocked = ORCHESTRATOR_AGENTS.has(callerAgent) && ORCHESTRATOR_AGENTS.has(targetAgent)
    expect(blocked).toBe(false)
  })
})
