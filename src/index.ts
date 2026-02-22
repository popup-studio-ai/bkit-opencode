/**
 * bkit-opencode Plugin Entry Point
 *
 * Registers all hooks and custom tools with the OpenCode plugin system.
 * This is the main export that OpenCode loads when the plugin starts.
 *
 * Hook registration follows OpenCode's plugin interface:
 * - Hooks are called sequentially by Plugin.trigger()
 * - config hook is called by Plugin.init() with the full config object
 * - event hook is called by Plugin.init() Bus.subscribeAll()
 * - All other hooks are called via Plugin.trigger(name, input, output)
 */

import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin"
import { createSessionHandler } from "./hooks/session"
import { createMessageHandler } from "./hooks/message"
import { createToolBeforeHandler } from "./hooks/tool-before"
import { createToolAfterHandler } from "./hooks/tool-after"
import { createSystemPromptHandler } from "./hooks/system-prompt"
import { createCompactionHandler } from "./hooks/compaction"
import { createPermissionHandler } from "./hooks/permission"
import { buildConfigHook } from "./hooks/config"
import { createPdcaStatusTool } from "./tools/pdca-status"
import { createLevelInfoTool } from "./tools/level-info"
import { createDelegateTaskTool } from "./tools/delegate-task"
import { createDelegateResultTool } from "./tools/delegate-result"
import { createAgentActivityTool } from "./tools/agent-activity"
import { createAgentMailboxTool } from "./tools/agent-mailbox"
import { createAgentMonitorTool } from "./tools/agent-monitor"
import { createTaskBoardTool } from "./tools/task-board"
import { initPlatform, getPluginRoot } from "./lib/core/platform"
import { guardedHookFactory, safeHandler } from "./lib/core/safe-hook"
import { patchClientAuth } from "./lib/core/server-auth"
import { fileURLToPath } from "url"
import { dirname } from "path"

// Portable: Bun has import.meta.dir, Node.js needs import.meta.url fallback
const _thisDir = typeof import.meta.dir === "string"
  ? import.meta.dir
  : dirname(fileURLToPath(import.meta.url))

const bkitPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  // Inject Basic Auth into SDK client if OPENCODE_SERVER_PASSWORD is set.
  // Without this, client.session.create() returns "Unauthorized".
  patchClientAuth(input.client)

  // Initialize platform with directory context
  initPlatform({
    directory: input.directory,
    worktree: input.worktree,
    pluginRoot: _thisDir,
  })

  return {
    // Config hook: register agents, skills, MCP (bkend), commands
    // Called by Plugin.init() BEFORE Agent.state() resolves
    config: guardedHookFactory("config", () => buildConfigHook(input)),

    // Session lifecycle events (session.created, session.deleted)
    event: guardedHookFactory("session", () => createSessionHandler(input)),

    // Message interception for intent detection and auto-triggers
    "chat.message": guardedHookFactory("message", () =>
      safeHandler("message", createMessageHandler(input)),
    ),

    // Pre-tool execution: log PDCA writes, warn on dangerous commands
    "tool.execute.before": guardedHookFactory("tool-before", () =>
      safeHandler("tool-before", createToolBeforeHandler(input)),
    ),

    // Post-tool execution: auto-advance PDCA phase based on file paths
    "tool.execute.after": guardedHookFactory("tool-after", () =>
      safeHandler("tool-after", createToolAfterHandler(input)),
    ),

    // System prompt injection: PDCA status, agents, triggers, team info
    "experimental.chat.system.transform": guardedHookFactory("system-prompt", () =>
      safeHandler("system-prompt", createSystemPromptHandler(input)),
    ),

    // Context compaction: preserve PDCA state across compaction
    "experimental.session.compacting": guardedHookFactory("compaction", () =>
      safeHandler("compaction", createCompactionHandler(input)),
    ),

    // Permission control: deny dangerous bash commands, ask for risky ones
    "permission.ask": guardedHookFactory("permission", () =>
      safeHandler("permission", createPermissionHandler(input)),
    ),

    // Custom tools
    // "agent" is bkit's agent delegation tool (spawns specialized sub-agents)
    // "agent_result" is the companion for checking background agent results
    tool: {
      "bkit-pdca-status": createPdcaStatusTool(input),
      "bkit-level-info": createLevelInfoTool(input),
      "bkit-agent-activity": createAgentActivityTool(input),
      "bkit-agent-mailbox": createAgentMailboxTool(input),
      "bkit-agent-monitor": createAgentMonitorTool(input),
      "bkit-task-board": createTaskBoardTool(input),
      agent: createDelegateTaskTool(input),
      agent_result: createDelegateResultTool(input),
    },
  }
}

export default bkitPlugin
