/**
 * bkit delegate-task Tool (registered as "agent")
 *
 * Agent delegation tool using the OpenCode SDK client (PluginInput.client).
 * Creates child sessions and invokes agents with specialized prompts.
 *
 * SDK migration (v2): Replaces raw HTTP fetch() calls with typed SDK client,
 * eliminating manual URL construction, auth header management, and error parsing.
 *
 * Flow:
 *   1. client.session.create() — create child session
 *   2. client.session.promptAsync() — invoke with specific agent
 *   3. Event (session.status idle) OR client.session.status() poll
 *   4. client.session.messages() — extract result
 */

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import { join } from "path"
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs"
import { randomBytes } from "crypto"
import {
  readAgentState, initAgentState, addTeammate,
  updateTeammateStatus, addRecentMessage,
} from "../lib/team/state-writer"
import { taskManager } from "../lib/task/background-manager"
import { taskDebugLog } from "../lib/task/http-debug"
import { formatTaskError } from "../lib/task/error-formatting"
import { AgentMessage, extractResultText } from "../lib/task/message-utils"
import { recordAgentSpawn, recordAgentCompletion } from "../lib/team/activity-log"
import { getUnread, markAllRead } from "../lib/team/mailbox"
import { getEffectiveDisallowedTools } from "../lib/agent-orchestrator"

type SdkClient = PluginInput["client"]

// Agent registry — metadata for validation, model routing, and system prompt enrichment
// C3: Added recommendedModel for per-agent model routing (undefined = inherit parent model)
interface AgentMeta {
  description: string
  phases: string[]
  category: string
  recommendedModel?: string  // "provider/model" format, e.g. "anthropic/claude-sonnet-4-5-20250929"
}

const AGENTS: Record<string, AgentMeta> = {
  "cto-lead": { description: "CTO-level orchestrator, PDCA workflow management", phases: ["research", "plan", "design", "do", "check", "act"], category: "orchestration" },
  "product-manager": { description: "Requirements analysis, feature specs, user stories", phases: ["plan"], category: "planning" },
  "frontend-architect": { description: "UI/UX architecture, component design, design system", phases: ["design", "do"], category: "development" },
  "security-architect": { description: "Vulnerability analysis, auth design, OWASP compliance", phases: ["design", "check"], category: "security" },
  "enterprise-expert": { description: "Enterprise architecture and AI-Native patterns", phases: ["design"], category: "architecture" },
  "infra-architect": { description: "AWS, Kubernetes, Terraform infrastructure design", phases: ["design", "do"], category: "architecture" },
  "backend-expert": { description: "Backend development across all languages and frameworks", phases: ["design", "do", "act"], category: "development" },
  "baas-expert": { description: "bkend.ai BaaS integration, auth, database, API", phases: ["design", "do", "check", "act"], category: "development" },
  "design-validator": { description: "Design document completeness and consistency validation", phases: ["design"], category: "verification" },
  "gap-detector": { description: "Design vs implementation gap analysis", phases: ["check"], category: "verification" },
  "code-analyzer": { description: "Code quality, security scan, architecture compliance", phases: ["check"], category: "verification" },
  "qa-strategist": { description: "Test strategy, quality metrics, verification coordination", phases: ["check"], category: "verification" },
  "qa-monitor": { description: "Zero Script QA via Docker log monitoring", phases: ["check"], category: "verification" },
  "pdca-iterator": { description: "Auto-iterate evaluation and improvement cycles", phases: ["act"], category: "improvement" },
  "report-generator": { description: "Generate PDCA completion reports", phases: ["check"], category: "reporting" },
  "pipeline-guide": { description: "9-phase development pipeline guidance", phases: ["research", "plan", "design", "do", "check", "act"], category: "guidance" },
  "starter-guide": { description: "Beginner-friendly guidance for new developers", phases: ["research", "plan", "design", "do", "check", "act"], category: "guidance" },
}

/**
 * C3: Resolve model for an agent with priority chain:
 *   1. args.model (user explicit override) — highest priority
 *   2. AGENTS[name].recommendedModel (registry default)
 *   3. undefined (inherit from agent definition / parent session)
 */
function resolveModel(
  userModel: string | undefined,
  agentName: string,
): { providerID: string; modelID: string } | undefined {
  // Priority 1: User explicit override
  if (userModel) {
    const parsed = parseModelRef(userModel)
    if (parsed) return parsed
  }

  // Priority 2: Agent registry recommended model
  const meta = AGENTS[agentName]
  if (meta?.recommendedModel) {
    const parsed = parseModelRef(meta.recommendedModel)
    if (parsed) return parsed
  }

  // Priority 3: Inherit (return undefined)
  return undefined
}

/**
 * C5: Category-based system prompt injection.
 * Appended to child session's system prompt for role-specific guidance.
 */
const CATEGORY_PROMPTS: Record<string, string> = {
  verification: `<Context>You are performing VERIFICATION tasks.
Focus on: accuracy, completeness, design-implementation alignment.
Report findings with specific file paths and line numbers.
Do NOT modify code — only analyze and report.</Context>`,

  development: `<Context>You are performing DEVELOPMENT tasks.
Match existing code style. Search codebase patterns before writing.
Prefer minimal changes that fulfill requirements.
Run relevant tests after making changes.</Context>`,

  planning: `<Context>You are performing PLANNING tasks.
Interview users about requirements first. Identify uncertainties.
Output structured plan documents with clear acceptance criteria.</Context>`,

  orchestration: `<Context>You are an ORCHESTRATOR agent.
Coordinate work across specialized agents. Track progress and quality gates.
Delegate to specialized agents instead of doing implementation yourself.</Context>`,

  architecture: `<Context>You are performing ARCHITECTURE tasks.
Consider scalability, maintainability, and security implications.
Reference existing patterns in the codebase before proposing changes.</Context>`,

  security: `<Context>You are performing SECURITY REVIEW tasks.
Check OWASP Top 10. Validate authentication and authorization flows.
Report vulnerabilities with severity ratings and remediation steps.</Context>`,

  improvement: `<Context>You are performing IMPROVEMENT tasks.
Fix gaps identified in analysis. Re-verify after each fix.
Stop when match rate reaches the threshold or max iterations.</Context>`,
}

const PENDING_FINISH_REASONS = new Set(["tool-calls", "unknown"])
const FALLBACK_POLL_INTERVAL_MS = 5000
const MAX_POLL_TIME_MS = 1_800_000 // 30 minutes
const MAX_DELEGATION_DEPTH = 3

/**
 * H-4: Session chain depth tracking for recursion prevention.
 *
 * Maps sessionID → delegation depth. When a child session's agent calls
 * the agent tool, ctx.sessionID is the child's ID, so we can look up its
 * depth and block if >= MAX_DELEGATION_DEPTH.
 *
 * This works because all sessions run in the same OpenCode server process
 * and share the same plugin instance (same module-level state).
 *
 * Entries are cleaned up when sessions complete, timeout, or abort.
 */
const sessionDepths = new Map<string, number>()

// AgentMessage type imported from lib/task/message-utils

// ---------------------------------------------------------------------------
// Debug logging (file-based for production diagnostics)
// ---------------------------------------------------------------------------

function debugLog(label: string, msg: string, data?: any): void {
  taskDebugLog("task", label, msg, data)
}

// ---------------------------------------------------------------------------
// SDK Helper Functions
// ---------------------------------------------------------------------------

/** Fetch messages for a session via SDK client. */
async function fetchMessages(client: SdkClient, sessionID: string): Promise<AgentMessage[]> {
  try {
    const result = await client.session.messages({ path: { id: sessionID } })
    if (result.error) {
      debugLog("sdk", `messages error for ${sessionID}`, { error: result.error })
      return []
    }
    return Array.isArray(result.data) ? result.data as AgentMessage[] : []
  } catch (e: any) {
    debugLog("sdk", `messages fetch failed for ${sessionID}`, { error: e?.message })
    return []
  }
}

/** Check if a session is idle via SDK client. */
async function checkSessionIdle(client: SdkClient, sessionID: string, directory: string): Promise<boolean> {
  try {
    const result = await client.session.status({ query: { directory } })
    if (result.error || !result.data) return false
    const sessionStatus = (result.data as any)[sessionID]
    return !sessionStatus || sessionStatus.type === "idle"
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getOutputDir(directory: string): string {
  return join(directory, ".bkit", "agent-output")
}

function generateJobId(): string {
  return randomBytes(6).toString("hex")
}

function writeJobOutput(directory: string, jobId: string, data: Record<string, any>): void {
  const dir = getOutputDir(directory)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${jobId}.json`), JSON.stringify(data, null, 2))
}

/**
 * Determine if a session has finished processing by examining its messages.
 *
 * A session is complete when the final assistant message has a terminal finish
 * reason AND was produced after the last user prompt (ensuring the assistant
 * has responded to the most recent input, not a stale earlier turn).
 */
function isAgentSessionDone(messages: AgentMessage[]): boolean {
  // Find the most recent assistant and user messages
  const assistant = findLastByRole(messages, "assistant")
  const user = findLastByRole(messages, "user")

  // No assistant response yet → not complete
  if (!assistant) return false

  // Must have a terminal finish reason (excludes "tool_use", "length", etc.)
  const finish = assistant.info?.finish
  if (!finish || PENDING_FINISH_REASONS.has(finish)) return false

  // Ensure assistant responded AFTER the latest user prompt
  // (guards against stale completion from a previous turn)
  if (user?.info?.id && assistant.info?.id) {
    return user.info.id < assistant.info.id
  }

  // If IDs aren't available, trust the finish reason alone
  return true
}

function findLastByRole(messages: AgentMessage[], role: string): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].info?.role === role) return messages[i]
  }
  return undefined
}

// extractResultText imported from lib/task/message-utils

function parseModelRef(model: string): { providerID: string; modelID: string } | undefined {
  const slash = model.indexOf("/")
  if (slash <= 0) return undefined
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
}

// ---------------------------------------------------------------------------
// Team State Integration
// Tracks agent orchestration in .bkit/agent-state.json (like Claude Code's
// SubagentStart/SubagentStop hooks).
// ---------------------------------------------------------------------------

/** Ensure agent state is initialized for team tracking. */
function ensureAgentState(directory: string, feature: string, sessionId: string): void {
  try {
    const existing = readAgentState(directory)
    if (existing?.enabled) return // Already initialized

    // Try to read current PDCA feature and phase
    let pdcaFeature = feature || "default"
    let pdcaPhase = "do"
    try {
      const statusPath = join(directory, "docs", ".pdca-status.json")
      if (existsSync(statusPath)) {
        const status = JSON.parse(readFileSync(statusPath, "utf8"))
        if (status?.primaryFeature) pdcaFeature = status.primaryFeature
        const feat = status?.features?.[pdcaFeature]
        if (feat?.phase) pdcaPhase = feat.phase
      }
    } catch (e: any) {
      debugLog("team", `Failed to read PDCA status for agent state: ${e?.message}`)
    }

    initAgentState("bkit-team", pdcaFeature, {
      pdcaPhase,
      orchestrationPattern: "leader",
      ctoAgent: "opus",
      sessionId,
    }, directory)
    debugLog("team", "Agent state initialized", { feature: pdcaFeature, phase: pdcaPhase })
  } catch (e: any) {
    debugLog("team", "Failed to init agent state (non-fatal)", { error: e.message })
  }
}

/** Register agent as a teammate when spawned. Stores sessionId for event-driven tracking. */
function registerTeammate(
  directory: string, agentName: string, task: string,
  sessionId: string, jobId?: string
): void {
  try {
    const agentMeta = AGENTS[agentName]
    addTeammate({
      name: agentName,
      role: agentMeta?.category ?? "agent",
      model: "default",
      currentTask: task.slice(0, 200),
      taskId: jobId ?? undefined,
      sessionId: sessionId,
    }, directory)

    addRecentMessage({
      from: "system",
      to: agentName,
      content: `Spawned ${agentName}: ${task.slice(0, 100)}`,
    }, directory)

    debugLog("team", "Teammate registered", { name: agentName, jobId })
  } catch (e: any) {
    debugLog("team", "Failed to register teammate (non-fatal)", { error: e.message })
  }
}

/** Update teammate status on completion/failure. */
function updateTeamState(
  directory: string, agentName: string,
  status: "working" | "completed" | "failed" | "aborted" | "running",
  task?: string
): void {
  try {
    const state = readAgentState(directory)
    if (!state?.enabled) return

    // Map to state-writer's allowed statuses
    const mappedStatus = status === "aborted" ? "failed" as const
      : status === "running" ? "working" as const
      : status as "working" | "completed" | "failed"

    updateTeammateStatus(agentName, mappedStatus, task ? { task: task.slice(0, 200) } : null, directory)

    if (status === "completed" || status === "failed" || status === "aborted") {
      addRecentMessage({
        from: agentName,
        to: "cto-lead",
        content: `${agentName} ${status}${task ? `: ${task.slice(0, 80)}` : ""}`,
      }, directory)
    }
  } catch (e: any) {
    debugLog("team", `Failed to update team state for ${agentName} (non-fatal)`, { error: e.message })
  }
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export function createDelegateTaskTool(input: PluginInput) {
  const client = input.client

  debugLog("init", "delegate-task tool created (SDK client)", {
    serverUrl: input.serverUrl?.toString(),
    hasClient: !!client,
  })

  return tool({
    description: `Spawn a specialized agent to execute a task. Creates a child session and invokes the agent with its specialized prompt and model.

Available agents: ${Object.entries(AGENTS).map(([name, info]) => `${name} (${info.description})`).join(", ")}

Use run_in_background=true for parallel tasks (returns job_id immediately).
Use run_in_background=false (default) for sequential tasks (waits for result).
Use session_id to continue a previous agent session with a follow-up prompt.
Check background results with agent_result(job_id="...") or agent_result(list_all=true).`,
    args: {
      agent_name: tool.schema.string().optional().describe(
        `Agent to invoke. One of: ${Object.keys(AGENTS).join(", ")}. Optional when using session_id (auto-restored from previous session).`
      ),
      task: tool.schema.string().describe("Full task prompt for the agent"),
      run_in_background: tool.schema.boolean().optional().describe(
        "true=async (returns job_id), false=sync (waits for result). Default: false"
      ),
      model: tool.schema.string().optional().describe(
        "Model override (e.g. 'openrouter/deepseek/deepseek-v3.2'). Uses agent default if omitted."
      ),
      session_id: tool.schema.string().optional().describe(
        "Continue an existing agent session instead of creating a new one. Preserves full conversation context."
      ),
      abort_session_id: tool.schema.string().optional().describe(
        "Session ID to abort before spawning. Use to redirect a misdirected agent. Can be used alone (abort-only) or combined with agent_name+task (abort+redirect)."
      ),
    },
    async execute(args, ctx) {
      let agentName = args.agent_name?.trim()
      const task = args.task?.trim()
      const runInBackground = args.run_in_background === true
      const directory = ctx.directory
      const isContinuation = !!args.session_id

      // FR-02: Abort + Redirect — abort a running session before spawning replacement
      if (args.abort_session_id) {
        // Collect partial results BEFORE aborting (best-effort)
        let partialResult = ""
        try {
          const msgs = await fetchMessages(client, args.abort_session_id)
          if (msgs.length > 0) {
            partialResult = extractResultText(msgs)
          }
        } catch { /* non-fatal */ }

        try {
          await client.session.abort({ path: { id: args.abort_session_id } })
          const abortedAgent = taskManager.getAgentForSession(args.abort_session_id)
          if (abortedAgent) {
            updateTeamState(directory, abortedAgent, "aborted")
            recordAgentCompletion(directory, args.abort_session_id, "aborted",
              partialResult ? `Partial: ${partialResult.slice(0, 200)}` : "Aborted by CTO redirect")

            // Update agent-output file with partial result + session_id
            const outputDir = getOutputDir(directory)
            if (existsSync(outputDir)) {
              const files = readdirSync(outputDir).filter(f => f.endsWith(".json"))
              for (const file of files) {
                try {
                  const data = JSON.parse(readFileSync(join(outputDir, file), "utf-8"))
                  if (data.sessionId === args.abort_session_id && data.status === "running") {
                    writeJobOutput(directory, file.replace(".json", ""), {
                      ...data,
                      status: "aborted",
                      output: partialResult.slice(0, 10000) || null,
                      completedAt: new Date().toISOString(),
                      duration: data.startedAt
                        ? Date.now() - new Date(data.startedAt).getTime()
                        : null,
                    })
                    break
                  }
                } catch { /* skip malformed */ }
              }
            }
          }
          taskManager.unregisterSession(args.abort_session_id)
          sessionDepths.delete(args.abort_session_id)
          debugLog("abort", `Session ${args.abort_session_id} aborted`, { agent: abortedAgent, hasPartial: !!partialResult })
        } catch (e: any) {
          debugLog("abort", `Abort failed (non-fatal): ${e?.message}`)
        }
        // Abort-only mode: no task/agent → return abort result with session_id for continuation
        if (!args.task && !args.agent_name && !args.session_id) {
          return [
            `Session ${args.abort_session_id} aborted.`,
            partialResult ? `\nPartial result preserved.` : "",
            `\nsession_id: ${args.abort_session_id}`,
            `\nUse task(session_id="${args.abort_session_id}", agent_name="...", task="continue from where you left off") to resume.`,
          ].filter(Boolean).join("")
        }
      }

      // agent_name is required for new sessions, optional for continuation
      if (!agentName && !isContinuation) return "Error: agent_name is required"
      if (!task) return "Error: task is required"

      // C2: Track anchor message count for continuation result extraction
      let anchorMessageCount = 0

      // H-4: Recursion depth guard — prevent infinite agent delegation chains.
      // ctx.sessionID is the CALLING session's ID. If it was itself spawned by
      // a parent delegation, its depth is already recorded in sessionDepths.
      const parentDepth = sessionDepths.get(ctx.sessionID) ?? 0
      if (parentDepth >= MAX_DELEGATION_DEPTH) {
        debugLog("depth-guard", `Blocked: depth ${parentDepth} >= max ${MAX_DELEGATION_DEPTH}`, {
          sessionID: ctx.sessionID, agent: agentName,
        })
        return `Error: Maximum delegation depth (${MAX_DELEGATION_DEPTH}) reached. Agent "${agentName}" cannot spawn further sub-agents. Return your result to the parent instead.`
      }

      // C2: For continuation, auto-restore agent/model from previous session if not provided
      let restoredModel: { providerID: string; modelID: string } | undefined
      if (isContinuation && !agentName) {
        try {
          const prevMsgs = await fetchMessages(client, args.session_id!)
          anchorMessageCount = prevMsgs.length
          // Scan messages in reverse to find agent info
          for (let i = prevMsgs.length - 1; i >= 0; i--) {
            const info = prevMsgs[i].info as any
            if (info?.agent) {
              agentName = info.agent
              debugLog("continuation", `Auto-restored agent: ${agentName}`)
              break
            }
          }
          // Also check session registry for agent name
          if (!agentName) {
            agentName = taskManager.getAgentForSession(args.session_id!)
            if (agentName) debugLog("continuation", `Restored agent from registry: ${agentName}`)
          }
        } catch (e: any) {
          debugLog("continuation", `Failed to auto-restore agent: ${e?.message}`)
        }
        if (!agentName) {
          return "Error: Could not auto-detect agent for session continuation. Please provide agent_name."
        }
      } else if (isContinuation) {
        // agent_name was provided — still record anchor for result extraction
        try {
          const prevMsgs = await fetchMessages(client, args.session_id!)
          anchorMessageCount = prevMsgs.length
        } catch {
          // Non-fatal: result extraction will just use all messages
        }
      }

      // Validate agent exists via SDK
      let validatedAgent = agentName!
      try {
        const agentsResult = await client.app.agents()
        if (!agentsResult.error && Array.isArray(agentsResult.data)) {
          const callable = (agentsResult.data as any[]).filter(a => a.mode !== "primary")
          const matched = callable.find(a => a.name?.toLowerCase() === agentName!.toLowerCase())

          if (!matched) {
            const available = callable.map(a => a.name).sort().join(", ")
            return `Error: Agent "${agentName}" not found or not callable.\nAvailable agents: ${available}`
          }
          validatedAgent = matched.name
        } else {
          // SDK call failed — fallback to static registry
          if (!AGENTS[agentName!]) {
            return `Error: Unknown agent "${agentName}".\nKnown agents: ${Object.keys(AGENTS).join(", ")}`
          }
        }
      } catch (e: any) {
        // Fallback: proceed with given name if in static registry
        if (!AGENTS[agentName!]) {
          return `Error: Unknown agent "${agentName}".\nKnown agents: ${Object.keys(AGENTS).join(", ")}\nValidation error: ${e?.message ?? "unknown"}`
        }
      }

      // C4: Self-delegation prevention — block same-agent and orchestrator loops
      // ctx.agent is an undocumented OpenCode SDK field (agent name of the calling session)
      const callerAgent = "agent" in ctx ? (ctx.agent as string | undefined) : undefined
      if (callerAgent && callerAgent.toLowerCase() === validatedAgent.toLowerCase()) {
        debugLog("self-delegation", `Blocked: "${callerAgent}" tried to delegate to itself`)
        return `Error: Agent "${validatedAgent}" cannot delegate to itself. Execute the task directly instead.`
      }
      const ORCHESTRATOR_AGENTS = new Set(["cto-lead"])
      if (ORCHESTRATOR_AGENTS.has(callerAgent?.toLowerCase() ?? "") &&
          ORCHESTRATOR_AGENTS.has(validatedAgent.toLowerCase())) {
        debugLog("self-delegation", `Blocked: orchestrator "${callerAgent}" → "${validatedAgent}"`)
        return `Error: Orchestrator agents cannot delegate to other orchestrators. Execute the task directly.`
      }

      // Validate session context
      if (!ctx.sessionID && !args.session_id) {
        return `Error: No parent session ID available. Cannot create child session.`
      }

      // Session creation or continuation
      let sessionID: string

      if (isContinuation) {
        // Continue existing session — skip creation
        sessionID = args.session_id!
        debugLog("session", "Continuing existing session", {
          sessionID, agent: validatedAgent, anchorMessageCount,
        })
      } else {
        // Create child session via SDK
        try {
          const createResult = await client.session.create({
            body: {
              parentID: ctx.sessionID,
              title: `${validatedAgent} — ${task.slice(0, 50)}`,
            } as any,
            query: { directory },
          })

          const createError = (createResult as any).error
          if (createError) {
            debugLog("session-create", "SDK error", {
              error: createError,
              parentID: ctx.sessionID,
              directory,
            })
            return formatTaskError(
              new Error(typeof createError === "string" ? createError : JSON.stringify(createError)),
              { operation: "Session creation", agent: validatedAgent },
            )
          }

          sessionID = (createResult.data as any)?.id
          if (!sessionID) {
            debugLog("session-create", "No session ID in response", { data: createResult.data })
            return formatTaskError(
              new Error("session.create returned no session ID"),
              { operation: "Session creation", agent: validatedAgent },
            )
          }

          // H-4: Register child session depth = parent + 1
          sessionDepths.set(sessionID, parentDepth + 1)
          debugLog("session-create", "Session created via SDK", { sessionID, parentID: ctx.sessionID, depth: parentDepth + 1 })
        } catch (e: any) {
          debugLog("session-create", "SDK call failed", { error: e?.message })
          return formatTaskError(e, { operation: "Session creation", agent: validatedAgent, task })
        }
      }

      // Build prompt body with C3 model routing
      const resolvedModel = resolveModel(args.model, validatedAgent)
      const promptBody: Record<string, any> = {
        agent: validatedAgent,
        parts: [{ type: "text" as const, text: task }],
      }
      if (resolvedModel) {
        promptBody.model = resolvedModel
        debugLog("model", `Resolved model for ${validatedAgent}`, { model: resolvedModel })
      }

      // C5: Inject category-based system prompt
      const agentMeta = AGENTS[validatedAgent]
      const categoryPrompt = CATEGORY_PROMPTS[agentMeta?.category ?? ""]
      if (categoryPrompt) {
        promptBody.system = categoryPrompt
        debugLog("system-prompt", `Injected ${agentMeta.category} prompt for ${validatedAgent}`)
      }

      // FR-01.2: Inject agent tool constraints (soft — system prompt based)
      const disallowedTools = getEffectiveDisallowedTools(validatedAgent)
      if (disallowedTools.length > 0) {
        const constraintBlock = `\n<ToolConstraints>\nDo NOT use these tools: ${disallowedTools.join(", ")}.\nIf you need modifications, describe them in your output and let the parent agent handle it.\n</ToolConstraints>\n`
        promptBody.system = (promptBody.system || "") + constraintBlock
        debugLog("tool-constraints", `Injected ${disallowedTools.length} constraints for ${validatedAgent}`, { disallowedTools })
      }

      // FR-08: Inject mailbox polling guide for background sub-agents only.
      // Orchestrators (cto-lead) are senders, not receivers.
      // Sync agents finish too quickly for mid-task messages to matter.
      const isOrchestrator = ORCHESTRATOR_AGENTS.has(validatedAgent.toLowerCase())
      if (runInBackground && !isOrchestrator) {
        const pollingGuide = `\n<AgentGuide>
The parent agent may send you mid-task directives via the mailbox system.
- Every 5-10 tool calls, run: bkit-agent-mailbox(action="receive") to check for new messages.
- If you receive a message, adjust your work accordingly (refocus, stop, change approach).
- When your task is complete, include a clear summary of what you did and key findings.
</AgentGuide>\n`
        promptBody.system = (promptBody.system || "") + pollingGuide
        debugLog("agent-guide", `Injected mailbox polling guide for background agent ${validatedAgent}`)
      }

      // FR-06: Inject unread mailbox messages into system prompt
      try {
        const unreadMsgs = getUnread(directory, validatedAgent)
        if (unreadMsgs.length > 0) {
          const msgLines = unreadMsgs.map(m =>
            `- [${m.from} -> you]: "${m.content}"`
          ).join("\n")
          const mailboxBlock = `\n<IncomingMessages>\n${msgLines}\n</IncomingMessages>\n`
          promptBody.system = (promptBody.system || "") + mailboxBlock
          markAllRead(directory, validatedAgent)
          debugLog("mailbox", `Injected ${unreadMsgs.length} messages for ${validatedAgent}`)
        }
      } catch (e: any) {
        debugLog("mailbox", `Message injection failed (non-fatal): ${e?.message}`)
      }

      // Initialize team state, register this agent, and register session for event tracking
      ensureAgentState(directory, "", ctx.sessionID)
      if (!isContinuation) {
        registerTeammate(directory, validatedAgent, task, sessionID)
      }
      taskManager.registerSession(sessionID, validatedAgent)

      const startTime = Date.now()
      // Generate activityId early so it can be reused as jobId in background mode
      const activityId = runInBackground ? generateJobId() : `sync-${generateJobId()}`

      // Record agent spawn in unified activity log
      recordAgentSpawn(directory, {
        id: activityId,
        agentName: validatedAgent,
        taskSummary: task,
        sessionId: sessionID,
        mode: runInBackground ? "background" : "sync",
        continuation: isContinuation,
      })

      if (runInBackground) {
        // Async mode: send prompt and return immediately
        const jobId = activityId
        writeJobOutput(directory, jobId, {
          status: "running",
          agent: validatedAgent,
          task: task.slice(0, 500),
          sessionId: sessionID,
          startedAt: new Date().toISOString(),
          continuation: isContinuation,
        })

        try {
          const promptResult = await client.session.promptAsync({
            path: { id: sessionID },
            body: promptBody as any,
          })
          if (promptResult.error) {
            writeJobOutput(directory, jobId, {
              status: "failed",
              agent: validatedAgent,
              error: String(promptResult.error),
              completedAt: new Date().toISOString(),
            })
            updateTeamState(directory, validatedAgent, "failed")
            taskManager.unregisterSession(sessionID)
            sessionDepths.delete(sessionID)
            recordAgentCompletion(directory, sessionID, "failed", String(promptResult.error).slice(0, 200))
            return formatTaskError(
              new Error(String(promptResult.error)),
              { operation: "Background prompt", sessionID, agent: validatedAgent, task },
            )
          }
        } catch (e: any) {
          writeJobOutput(directory, jobId, {
            status: "failed",
            agent: validatedAgent,
            error: e.message,
            completedAt: new Date().toISOString(),
          })
          updateTeamState(directory, validatedAgent, "failed")
          taskManager.unregisterSession(sessionID)
          sessionDepths.delete(sessionID)
          recordAgentCompletion(directory, sessionID, "failed", e.message?.slice(0, 200))
          return formatTaskError(e, { operation: "Background prompt", sessionID, agent: validatedAgent, task })
        }

        // Prompt sent successfully — transition spawning → working
        updateTeamState(directory, validatedAgent, "working", task)

        return [
          `Agent "${validatedAgent}" spawned in background.`,
          "",
          `job_id: ${jobId}`,
          `session_id: ${sessionID}`,
          "",
          `Use agent_result with job_id="${jobId}" to check progress and retrieve output.`,
        ].join("\n")
      }

      // -----------------------------------------------------------------------
      // Sync mode: event-based completion with polling fallback
      //
      // Key sequence to prevent race conditions:
      //   1. Register waitForIdle() BEFORE sending promptAsync
      //   2. Send promptAsync via SDK
      //   3. Race: event resolves instantly OR polling catches it
      // -----------------------------------------------------------------------
      debugLog("sync", `Registering event listener for session ${sessionID}`, { agent: validatedAgent })

      // Step 1: Register event listener BEFORE prompt (prevents race condition)
      const idlePromise = taskManager.waitForIdle(sessionID, MAX_POLL_TIME_MS)

      // Step 2: Send prompt via SDK
      debugLog("sync", `Sending promptAsync to session ${sessionID}`, { agent: validatedAgent })
      try {
        const promptResult = await client.session.promptAsync({
          path: { id: sessionID },
          body: promptBody as any,
        })
        debugLog("sync", `promptAsync result`, { error: promptResult.error ?? "none" })
        if (promptResult.error) {
          taskManager.cleanup(sessionID)
          taskManager.unregisterSession(sessionID)
          sessionDepths.delete(sessionID)
          updateTeamState(directory, validatedAgent, "failed")
          recordAgentCompletion(directory, sessionID, "failed", String(promptResult.error).slice(0, 200))
          return formatTaskError(
            new Error(String(promptResult.error)),
            { operation: "Sync prompt", sessionID, agent: validatedAgent, task },
          )
        }
      } catch (e: any) {
        taskManager.cleanup(sessionID)
        taskManager.unregisterSession(sessionID)
        sessionDepths.delete(sessionID)
        updateTeamState(directory, validatedAgent, "failed")
        recordAgentCompletion(directory, sessionID, "failed", e.message?.slice(0, 200))
        return formatTaskError(e, { operation: "Sync prompt", sessionID, agent: validatedAgent, task })
      }

      // Transition spawning → working
      updateTeamState(directory, validatedAgent, "working", task)

      // Step 3: Create polling fallback (5s interval — events are primary)
      const pollAbort = new AbortController()
      const pollFallbackPromise = (async () => {
        const pollStart = Date.now()
        let pollCount = 0
        while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
          if (pollAbort.signal.aborted) return
          if (ctx.abort?.aborted) throw new Error("aborted")
          await new Promise(r => setTimeout(r, FALLBACK_POLL_INTERVAL_MS))
          if (pollAbort.signal.aborted) return
          pollCount++
          try {
            const isIdle = await checkSessionIdle(client, sessionID, directory)
            debugLog("poll-fallback", `#${pollCount} idle=${isIdle}`, {
              elapsed: Math.round((Date.now() - pollStart) / 1000),
            })
            if (isIdle) return
          } catch {
            continue
          }
        }
        throw new Error("poll-timeout")
      })()

      // Step 4: Create abort watcher
      const abortPromise = ctx.abort
        ? new Promise<never>((_, reject) => {
            if (ctx.abort!.aborted) reject(new Error("aborted"))
            ctx.abort!.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
          })
        : new Promise<never>(() => {}) // Never resolves if no abort signal

      // Step 5: Race — event wins instantly, polling is safety net
      try {
        await Promise.race([idlePromise, pollFallbackPromise, abortPromise])
      } catch (e: any) {
        pollAbort.abort()
        taskManager.cleanup(sessionID)

        if (e.message === "aborted") {
          // Collect partial results BEFORE aborting (best-effort)
          let partialResult = ""
          try {
            const msgs = await fetchMessages(client, sessionID)
            if (msgs.length > 0) {
              partialResult = extractResultText(msgs, anchorMessageCount)
            }
          } catch { /* non-fatal */ }

          try { await client.session.abort({ path: { id: sessionID } }) } catch {}
          updateTeamState(directory, validatedAgent, "aborted")
          taskManager.unregisterSession(sessionID)
          sessionDepths.delete(sessionID)
          recordAgentCompletion(directory, sessionID, "aborted",
            partialResult ? `Partial: ${partialResult.slice(0, 200)}` : undefined)

          // Update agent-output file with partial result
          const outputDir = getOutputDir(directory)
          if (existsSync(outputDir)) {
            const files = readdirSync(outputDir).filter(f => f.endsWith(".json"))
            for (const file of files) {
              try {
                const data = JSON.parse(readFileSync(join(outputDir, file), "utf-8"))
                if (data.sessionId === sessionID && data.status === "running") {
                  writeJobOutput(directory, file.replace(".json", ""), {
                    ...data,
                    status: "aborted",
                    output: partialResult.slice(0, 10000) || null,
                    completedAt: new Date().toISOString(),
                    duration: data.startedAt
                      ? Date.now() - new Date(data.startedAt).getTime()
                      : null,
                  })
                  break
                }
              } catch { /* skip malformed */ }
            }
          }

          return [
            `Task aborted.`,
            partialResult ? `\nPartial result preserved.` : "",
            `\nsession_id: ${sessionID}`,
            `\nUse task(session_id="${sessionID}", agent_name="${validatedAgent}", task="continue from where you left off") to resume.`,
          ].filter(Boolean).join("")
        }

        // Timeout — save as background job
        const timeoutJobId = generateJobId()
        writeJobOutput(directory, timeoutJobId, {
          status: "running",
          agent: validatedAgent,
          task: task.slice(0, 500),
          sessionId: sessionID,
          startedAt: new Date(startTime).toISOString(),
          note: "Converted from sync timeout — agent may still be running",
        })
        updateTeamState(directory, validatedAgent, "running", task)
        return [
          `Sync wait timed out after ${Math.round(MAX_POLL_TIME_MS / 1000)}s, but the agent may still be running.`,
          `Agent: ${validatedAgent}`,
          "",
          `job_id: ${timeoutJobId}`,
          `session_id: ${sessionID}`,
          "",
          `Use agent_result(job_id="${timeoutJobId}") to check if the agent has finished and retrieve the result.`,
        ].join("\n")
      }

      // Race settled — determine winner before cleanup
      const resolvedByPoll = taskManager.isTracked(sessionID)
      pollAbort.abort()
      pollFallbackPromise.catch(() => {})
      taskManager.cleanup(sessionID)

      // Step 6: Verify completion via messages (handles "false idle")
      const MAX_IDLE_RETRIES = 3
      for (let attempt = 0; attempt < MAX_IDLE_RETRIES; attempt++) {
        const msgs = await fetchMessages(client, sessionID)

        debugLog("sync", `Idle detected, attempt ${attempt + 1}: ${msgs.length} messages`, {
          finishes: msgs.filter(m => m.info?.role === "assistant").map(m => m.info?.finish),
        })

        if (isAgentSessionDone(msgs)) {
          const duration = Math.round((Date.now() - startTime) / 1000)
          const result = extractResultText(msgs, anchorMessageCount)
          const resolvedBy = resolvedByPoll ? "poll" : "event"
          debugLog("sync", `Complete via ${resolvedBy} after ${duration}s`)
          updateTeamState(directory, validatedAgent, "completed")
          taskManager.unregisterSession(sessionID)
          sessionDepths.delete(sessionID)
          recordAgentCompletion(directory, sessionID, "completed", result.slice(0, 200))
          return [
            `Task completed in ${duration}s.`,
            `Agent: ${validatedAgent}`,
            "",
            "---",
            "",
            result,
            "",
            `session_id: ${sessionID}`,
          ].join("\n")
        }

        // Has assistant text but finish status unclear — accept as complete
        const hasAgentResponse = msgs.some(m => {
          if (m.info?.role !== "assistant") return false
          return m.parts?.some(p => (p.type === "text" || p.type === "reasoning") && (p.text ?? "").trim().length > 0)
        })
        if (hasAgentResponse) {
          const duration = Math.round((Date.now() - startTime) / 1000)
          const result = extractResultText(msgs, anchorMessageCount)
          debugLog("sync", `Complete via hasAgentResponse fallback after ${duration}s`)
          updateTeamState(directory, validatedAgent, "completed")
          taskManager.unregisterSession(sessionID)
          sessionDepths.delete(sessionID)
          recordAgentCompletion(directory, sessionID, "completed", result.slice(0, 200))
          return [
            `Task completed in ${duration}s.`,
            `Agent: ${validatedAgent}`,
            "",
            "---",
            "",
            result,
            "",
            `session_id: ${sessionID}`,
          ].join("\n")
        }

        // False idle — wait briefly and re-check
        debugLog("sync", `False idle (attempt ${attempt + 1}), re-waiting...`)
        await new Promise(r => setTimeout(r, 2000))
      }

      // After MAX_IDLE_RETRIES, return whatever we have
      const finalMsgs = await fetchMessages(client, sessionID)
      const result = extractResultText(finalMsgs, anchorMessageCount)
      const duration = Math.round((Date.now() - startTime) / 1000)
      updateTeamState(directory, validatedAgent, "completed")
      taskManager.unregisterSession(sessionID)
      sessionDepths.delete(sessionID)
      recordAgentCompletion(directory, sessionID, "completed", result.slice(0, 200))
      return [
        `Task completed in ${duration}s (idle retries exhausted).`,
        `Agent: ${validatedAgent}`,
        "",
        "---",
        "",
        result,
        "",
        `session_id: ${sessionID}`,
      ].join("\n")
    },
  })
}
