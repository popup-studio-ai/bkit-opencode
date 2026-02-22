/**
 * Unit tests for delegate-result utility functions.
 *
 * Tests extractResultText (delegate-result version) and job I/O helpers.
 *
 * Run: npx vitest run src/tools/__tests__/delegate-result.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { join } from "path"
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs"
import { tmpdir } from "os"
import { randomBytes } from "crypto"

// ---------------------------------------------------------------------------
// Re-implementations matching delegate-result.ts private functions
// ---------------------------------------------------------------------------

type AgentMessage = {
  info?: { role?: string; finish?: string; time?: { created?: number; completed?: number } }
  parts?: Array<{ type?: string; text?: string }>
}

function extractResultText(messages: AgentMessage[]): string {
  const assistants = messages
    .filter(m => m.info?.role === "assistant")
    .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))

  const last = assistants[0]
  if (!last) return "(No assistant response)"

  const textParts = last.parts?.filter(p => p.type === "text" || p.type === "reasoning") ?? []
  return textParts.map(p => p.text ?? "").filter(Boolean).join("\n") || "(Empty response)"
}

function getOutputDir(directory: string): string {
  return join(directory, ".bkit", "agent-output")
}

function readJobOutput(directory: string, jobId: string): Record<string, any> | null {
  const filePath = join(getOutputDir(directory), `${jobId}.json`)
  try {
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf-8"))
    }
  } catch {
    // ignore
  }
  return null
}

function writeJobOutput(directory: string, jobId: string, data: Record<string, any>): void {
  const dir = getOutputDir(directory)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${jobId}.json`), JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// Tests: extractResultText (delegate-result version)
// ---------------------------------------------------------------------------

describe("extractResultText (delegate-result)", () => {
  it("returns '(No assistant response)' for empty messages", () => {
    expect(extractResultText([])).toBe("(No assistant response)")
  })

  it("extracts text from assistant message", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [{ type: "text", text: "Result text" }],
      },
    ]
    expect(extractResultText(msgs)).toBe("Result text")
  })

  it("picks most recent assistant by created time", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [{ type: "text", text: "Old" }],
      },
      {
        info: { role: "assistant", time: { created: 300 } },
        parts: [{ type: "text", text: "New" }],
      },
      {
        info: { role: "assistant", time: { created: 200 } },
        parts: [{ type: "text", text: "Middle" }],
      },
    ]
    expect(extractResultText(msgs)).toBe("New")
  })

  it("joins multiple text/reasoning parts", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "assistant", time: { created: 100 } },
        parts: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "Answer" },
        ],
      },
    ]
    expect(extractResultText(msgs)).toBe("Thinking...\nAnswer")
  })

  it("ignores user messages", () => {
    const msgs: AgentMessage[] = [
      {
        info: { role: "user", time: { created: 200 } },
        parts: [{ type: "text", text: "User input" }],
      },
    ]
    expect(extractResultText(msgs)).toBe("(No assistant response)")
  })
})

// ---------------------------------------------------------------------------
// Tests: Job I/O (readJobOutput / writeJobOutput)
// ---------------------------------------------------------------------------

describe("Job I/O", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `bkit-test-${randomBytes(4).toString("hex")}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
      // cleanup best-effort
    }
  })

  it("writes and reads job output", () => {
    const jobId = "test-job-001"
    const data = {
      status: "running",
      agent: "gap-detector",
      task: "Analyze code",
      sessionId: "sess-abc",
      startedAt: "2026-01-01T00:00:00Z",
    }

    writeJobOutput(testDir, jobId, data)
    const result = readJobOutput(testDir, jobId)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("running")
    expect(result!.agent).toBe("gap-detector")
    expect(result!.sessionId).toBe("sess-abc")
  })

  it("returns null for non-existent job", () => {
    const result = readJobOutput(testDir, "does-not-exist")
    expect(result).toBeNull()
  })

  it("creates output directory if not exists", () => {
    const jobId = "auto-dir-test"
    writeJobOutput(testDir, jobId, { status: "running" })

    const outputDir = getOutputDir(testDir)
    expect(existsSync(outputDir)).toBe(true)
  })

  it("overwrites existing job data", () => {
    const jobId = "overwrite-test"
    writeJobOutput(testDir, jobId, { status: "running" })
    writeJobOutput(testDir, jobId, { status: "completed", output: "done" })

    const result = readJobOutput(testDir, jobId)
    expect(result!.status).toBe("completed")
    expect(result!.output).toBe("done")
  })
})
