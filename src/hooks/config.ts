/**
 * Config Hook
 *
 * Called by OpenCode during Plugin.init() with the loaded config object.
 * Mutates config in-place to register:
 *   - Agents from plugin's agents/*.md (parsed frontmatter + body as prompt)
 *   - Skills path (plugin's skills/ directory)
 *   - MCP servers (bkend.ai only — agent MCP removed)
 *   - Custom commands
 *
 * The config hook mutates config.agent, config.mcp, config.skills, and
 * config.command before Agent.state() and Skill.state() resolve (lazy init).
 *
 * Lifecycle:
 *   Config.state() → loads .opencode/ directories (agents from .md, plugins)
 *   Plugin.init()  → config hook runs → mutates config object in-place
 *   Agent.state()  → reads mutated config.agent (lazy, first access)
 *   Skill.state()  → reads mutated config.skills.paths (lazy, first access)
 */

import { join, basename } from "path"
import type { PluginInput } from "@opencode-ai/plugin"
import { loadBkitConfig } from "../lib/core/config"
import { detectLevel } from "../lib/pdca/level"
import { debugLog } from "../lib/core/debug"
import { getPluginRoot } from "../lib/core/platform"

/**
 * Config hook receives the SDK's Config type at runtime.
 * We use a permissive alias here because the SDK Config shape evolves
 * across versions and our mutations (permission.edit = Record<string,string>)
 * don't match the SDK's strict union types. Internal functions enforce
 * their own invariants via runtime guards.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PluginConfig = Record<string, any>

export function buildConfigHook(input: PluginInput) {
  return async (config: PluginConfig) => {
    try {
      const bkitConfig = await loadBkitConfig(input.directory)
      const level = detectLevel(input.directory)
      const pluginRoot = getPluginRoot()

      // 1. Register agents from plugin's agents/*.md files
      await registerAgents(config, pluginRoot, bkitConfig)

      // 2. Register skills path
      registerSkills(config, pluginRoot)

      // 3. Register MCP servers
      registerMcp(config)

      // 4. Register custom commands
      registerCommands(config, level ?? "Dynamic")

      // 5. Register tool visibility and permission config
      registerTools(config)

      // 6. Register PDCA document permissions (overrides plan mode deny)
      registerPermissions(config)

      debugLog("Config", "Config hook applied", {
        level,
        agentCount: Object.keys(config.agent ?? {}).length,
        skillPaths: config.skills?.paths?.length ?? 0,
        mcpCount: Object.keys(config.mcp ?? {}).length,
        commandCount: Object.keys(config.command ?? {}).length,
      })
    } catch (e: any) {
      debugLog("Config", "Config hook error (non-fatal)", { error: e.message })
    }
  }
}

// ---------------------------------------------------------------------------
// Agent Registration
// ---------------------------------------------------------------------------

/**
 * Simple YAML frontmatter parser for agent .md files.
 * Returns { data: Record<string, any>, content: string }
 */
function parseMarkdown(text: string): { data: Record<string, any>; content: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { data: {}, content: text }

  const frontmatter = match[1]
  const content = match[2]

  // Simple YAML parser for flat key-value pairs
  const data: Record<string, any> = {}
  let currentKey = ""
  let currentValue = ""
  let isMultiline = false

  for (const line of frontmatter.split("\n")) {
    // Check for top-level key
    if (!line.startsWith(" ") && !line.startsWith("\t") && line.includes(":")) {
      // Save previous key if multiline
      if (isMultiline && currentKey) {
        data[currentKey] = currentValue.trim()
      }

      const colonIdx = line.indexOf(":")
      const key = line.slice(0, colonIdx).trim()
      const rawValue = line.slice(colonIdx + 1).trim()

      if (rawValue === "|" || rawValue === ">") {
        // Multiline value starts on next line
        currentKey = key
        currentValue = ""
        isMultiline = true
      } else if (rawValue === "") {
        currentKey = key
        currentValue = ""
        isMultiline = true
      } else {
        // Simple value
        data[key] = parseYamlValue(rawValue)
        isMultiline = false
        currentKey = ""
      }
    } else if (isMultiline && currentKey) {
      // Continuation of multiline value
      currentValue += line.replace(/^ {2}/, "") + "\n"
    }
  }

  // Save last multiline key
  if (isMultiline && currentKey) {
    data[currentKey] = currentValue.trim()
  }

  return { data, content }
}

function parseYamlValue(raw: string): any {
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw === "null") return undefined
  const num = Number(raw)
  if (!isNaN(num) && raw !== "") return num
  // Remove surrounding quotes
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  return raw
}

/**
 * Read agent .md files from plugin's agents/ directory and register them
 * via config.agent mutation.
 *
 * OpenCode's Agent.state() reads config.agent entries and creates agents
 * with: model, prompt, description, temperature, mode, color, etc.
 */
async function registerAgents(config: PluginConfig, pluginRoot: string, bkitConfig: Record<string, any>): Promise<void> {
  if (!config.agent) config.agent = {}

  const agentsDir = join(pluginRoot, "..", "agents")
  const { readdirSync, readFileSync } = require("fs")

  let files: string[]
  try {
    files = readdirSync(agentsDir).filter((f: string) => f.endsWith(".md"))
  } catch {
    debugLog("Config", "No agents directory found", { agentsDir })
    return
  }

  const models = (bkitConfig.models ?? {}) as Record<string, { providerID?: string; modelID?: string }>

  // Map from agent name to tier for model resolution
  const agentTiers: Record<string, "opus" | "sonnet" | "haiku"> = {
    "cto-lead": "opus",
    "gap-detector": "opus",
    "code-analyzer": "opus",
    "security-architect": "opus",
    "enterprise-expert": "opus",
    "infra-architect": "opus",
    "pdca-iterator": "sonnet",
    "backend-expert": "sonnet",
    "baas-expert": "sonnet",
    "frontend-architect": "sonnet",
    "product-manager": "sonnet",
    "qa-strategist": "sonnet",
    "design-validator": "sonnet",
    "starter-guide": "sonnet",
    "pipeline-guide": "sonnet",
    "qa-monitor": "haiku",
    "report-generator": "haiku",
  }

  let registered = 0

  for (const file of files) {
    try {
      const filePath = join(agentsDir, file)
      const text = readFileSync(filePath, "utf-8")
      const { data, content } = parseMarkdown(text)

      const agentName = data.name || basename(file, ".md")

      // Don't override if user already configured this agent with a prompt
      if (config.agent[agentName]?.prompt) continue

      // Resolve model: bkit.config.json tier → fallback to .md frontmatter
      const tier = agentTiers[agentName]
      const tierModel = tier && models[tier]
        ? `${models[tier].providerID}/${models[tier].modelID}`
        : undefined
      const model = tierModel || data.model

      // Build agent config matching OpenCode's Config.Agent schema
      const agentConfig: Record<string, any> = {
        prompt: content.trim(),
      }
      if (model) agentConfig.model = model
      if (data.description) agentConfig.description = data.description
      if (data.temperature !== undefined) agentConfig.temperature = data.temperature
      if (data.top_p !== undefined) agentConfig.top_p = data.top_p
      if (data.mode) agentConfig.mode = data.mode
      if (data.color) agentConfig.color = data.color
      if (data.hidden !== undefined) agentConfig.hidden = data.hidden
      if (data.steps !== undefined) agentConfig.steps = data.steps

      // Merge: existing config takes priority (user overrides)
      config.agent[agentName] = {
        ...agentConfig,
        ...config.agent[agentName],
      }
      // But always set prompt if not already set
      if (!config.agent[agentName].prompt) {
        config.agent[agentName].prompt = content.trim()
      }

      registered++
    } catch (e: any) {
      debugLog("Config", `Failed to load agent ${file}`, { error: e.message })
    }
  }

  debugLog("Config", `Registered ${registered} agents from plugin`)
}

// ---------------------------------------------------------------------------
// Skills Registration
// ---------------------------------------------------------------------------

/**
 * Register plugin's skills directory via config.skills.paths.
 *
 * OpenCode's Skill.state() reads config.skills.paths and scans each path
 * for ** /SKILL.md files.
 */
function registerSkills(config: PluginConfig, pluginRoot: string): void {
  if (!config.skills) config.skills = {}
  if (!config.skills.paths) config.skills.paths = []

  const skillsDir = join(pluginRoot, "..", "skills")

  // Only add if not already in paths
  if (!config.skills.paths.includes(skillsDir)) {
    config.skills.paths.push(skillsDir)
    debugLog("Config", "Registered skills path", { skillsDir })
  }
}

// ---------------------------------------------------------------------------
// MCP Registration
// ---------------------------------------------------------------------------

/**
 * Register MCP servers:
 * - bkend.ai (remote, disabled by default)
 */
function registerMcp(config: PluginConfig): void {
  if (!config.mcp) config.mcp = {}

  // Only add bkend if not already configured by user
  if (!config.mcp.bkend) {
    config.mcp.bkend = {
      type: "remote",
      url: "https://api.bkend.ai/mcp",
      enabled: false, // Disabled by default — user must enable manually
    }
    debugLog("Config", "Registered bkend.ai MCP (disabled by default)")
  }

}

// ---------------------------------------------------------------------------
// Tool & Permission Configuration
// ---------------------------------------------------------------------------

/**
 * Configure tool visibility and permissions.
 *
 * - config.tools: controls which tools are visible/available
 * - config.permission: global default permission rules
 * - agent.permission: per-agent permission overrides
 *
 * The "agent" tool is our delegate-task plugin tool (registered as "agent" key
 * in index.ts).
 *
 * We set agent: "allow" globally so the primary chat agent can use it.
 * Sub-agents that shouldn't delegate get agent: "deny" per-agent.
 * Infinite loop prevention: delegate-task.ts tracks session chain depth
 * via module-level Map and blocks at MAX_DELEGATION_DEPTH (H-4).
 */
function registerTools(config: PluginConfig): void {
  // Disable conflicting built-in tools
  if (!config.tools) config.tools = {}
  config.tools = {
    ...config.tools,
    "task_*": false,     // Disable built-in task management tools
    teammate: false,     // Disable built-in teammate tool
  }

  // Global permission: allow agent tool so primary agent can delegate
  // "agent" tool — our delegate-task tool for agent spawning
  if (!config.permission) config.permission = {}
  config.permission = {
    ...config.permission,
    agent: "allow",
    agent_result: "allow",
    "bkit-agent-mailbox": "allow",
    "bkit-agent-monitor": "allow",
    "bkit-task-board": "allow",
  }

  // Per-agent permission: deny agent for read-only/analysis agents (prevent loops)
  if (!config.agent) config.agent = {}
  const readOnlyAgents = [
    "gap-detector", "code-analyzer", "design-validator",
    "qa-monitor", "report-generator", "starter-guide", "pipeline-guide",
  ]
  for (const agentName of readOnlyAgents) {
    if (!config.agent[agentName]) config.agent[agentName] = {}
    if (!config.agent[agentName].permission) config.agent[agentName].permission = {}
    config.agent[agentName].permission = {
      ...config.agent[agentName].permission,
      agent: "deny",
      agent_result: "deny",
    }
  }

  debugLog("Config", "Tool config applied", {
    disabledTools: Object.keys(config.tools).filter(k => config.tools[k] === false),
    globalPermission: { agent: config.permission.agent },
    readOnlyAgents,
  })
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

/**
 * Register PDCA document path permissions.
 *
 * OpenCode's plan mode (plan agent) denies all edit permissions: { edit: { "*": "deny" } }.
 * This makes it impossible to write PDCA documents during plan mode.
 *
 * Solution: Add allow rules for PDCA doc paths to config.permission.edit.
 * These rules are included in the `user` ruleset which is merged LAST
 * in Agent.state() → PermissionNext.merge(defaults, agentRules, user).
 * Since PermissionNext.evaluate() uses findLast(), user rules override agent deny.
 */
function registerPermissions(config: PluginConfig): void {
  if (!config.permission) config.permission = {}
  if (!config.permission.edit) config.permission.edit = {}

  // docs/ and state files — always writable even in plan mode
  // All state files live inside docs/ to prevent root-level creation
  const pdcaPaths: Record<string, "allow"> = {
    "docs/*": "allow",
    ".bkit/agent-state*": "allow",
    ".bkit/mailbox/*": "allow",
    ".bkit/shared-tasks*": "allow",
  }

  for (const [pattern, action] of Object.entries(pdcaPaths)) {
    // Don't override if user explicitly set a different rule for this path
    if (config.permission.edit[pattern] === undefined) {
      config.permission.edit[pattern] = action
    }
  }

  debugLog("Config", "PDCA document permissions registered")
}

/**
 * Register PDCA-related commands.
 */
function registerCommands(config: PluginConfig, level: string): void {
  if (!config.command) config.command = {}

  if (!config.command["pdca-status"]) {
    config.command["pdca-status"] = {
      description: "Show current PDCA workflow status",
      template: "Show the current PDCA status using the bkit-pdca-status tool. Display the feature progress, current phase, and next steps.",
    }
  }

  if (!config.command["pdca-next"]) {
    config.command["pdca-next"] = {
      description: "Guide to next PDCA phase",
      template: "Use the bkit-pdca-status tool with action 'next' to show the next phase guidance. Then follow the recommended steps.",
    }
  }

  if (level !== "Starter" && !config.command["team-start"]) {
    config.command["team-start"] = {
      description: "Start PDCA Agent Team for a feature",
      template: "Use the bkit-team-start tool to create a PDCA Agent Team. Ask the user for the feature name if not provided.",
    }
  }
}
