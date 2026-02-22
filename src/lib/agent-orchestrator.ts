/**
 * Agent Orchestrator — Layer 2 Behavioral Rules
 *
 * Parses agent .md frontmatter to extract behavioral configuration:
 * model, temperature, mode, permission-mode, allowed/disallowed tools,
 * score-threshold.
 *
 * Provides getAgentConfig(agentName) for runtime rule lookup.
 * Cache: 30s TTL, matches skill-orchestrator.ts pattern.
 */

import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { debugLog } from "./core/debug"
import { getPluginRoot } from "./core/platform"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentBehavioralConfig {
  name: string
  model?: string
  temperature?: number
  mode?: "subagent" | "all"
  permissionMode?: "plan" | "acceptEdits" | "full"
  allowedTools?: string[]
  disallowedTools?: string[]
  scoreThreshold?: number
}

// ---------------------------------------------------------------------------
// Category-based default constraints (Layer 2 behavioral rules)
// ---------------------------------------------------------------------------

const CATEGORY_DEFAULTS: Record<string, { disallowedTools: string[] }> = {
  verification: { disallowedTools: ["Write", "Edit", "Bash"] },
  planning:     { disallowedTools: [] },
  reporting:    { disallowedTools: ["Bash"] },
}

const AGENT_CATEGORY: Record<string, string> = {
  "gap-detector": "verification",
  "code-analyzer": "verification",
  "design-validator": "verification",
  "qa-strategist": "verification",
  "qa-monitor": "verification",
  "product-manager": "planning",
  "report-generator": "reporting",
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const _cache = new Map<string, { config: AgentBehavioralConfig; ts: number }>()
const CACHE_TTL = 30_000

// ---------------------------------------------------------------------------
// Frontmatter Parser
// ---------------------------------------------------------------------------

function parseAgentFrontmatter(content: string, agentName: string): AgentBehavioralConfig {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return { name: agentName }

  const yaml = match[1]
  const config: AgentBehavioralConfig = { name: agentName }

  // Parse simple key: value pairs
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.+)$/)
    if (!kv) continue
    const [, key, rawVal] = kv
    const val = rawVal.trim()

    switch (key) {
      case "model": config.model = val; break
      case "temperature": config.temperature = parseFloat(val); break
      case "mode": config.mode = val as "subagent" | "all"; break
      case "permission-mode": config.permissionMode = val as any; break
      case "score-threshold": config.scoreThreshold = parseInt(val, 10); break
    }
  }

  // Parse array fields
  const parseArray = (pattern: RegExp): string[] | undefined => {
    const m = yaml.match(pattern)
    if (!m) return undefined
    return m[1].split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("-"))
      .map(l => l.replace(/^-\s+/, "").trim())
  }

  config.allowedTools = parseArray(/allowed-tools:\s*\n((?:\s+-\s+.+\n?)+)/)
  config.disallowedTools = parseArray(/disallowed-tools:\s*\n((?:\s+-\s+.+\n?)+)/)

  return config
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get behavioral config for an agent by name.
 * Reads and parses the agent's .md frontmatter with 30s cache.
 */
export function getAgentConfig(agentName: string): AgentBehavioralConfig | null {
  const cached = _cache.get(agentName)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.config

  const pluginRoot = getPluginRoot()
  const agentPath = join(pluginRoot, "..", "agents", `${agentName}.md`)

  if (!existsSync(agentPath)) {
    debugLog("AgentOrch", "Agent file not found", { agentName, path: agentPath })
    return null
  }

  try {
    const content = readFileSync(agentPath, "utf8")
    const config = parseAgentFrontmatter(content, agentName)
    _cache.set(agentName, { config, ts: Date.now() })
    debugLog("AgentOrch", "Config loaded", { agentName, model: config.model, mode: config.mode })
    return config
  } catch (e: any) {
    debugLog("AgentOrch", "Parse error", { agentName, error: e?.message })
    return null
  }
}

/**
 * Get the effective disallowed tools for an agent.
 * Merges explicit frontmatter disallowedTools with category defaults.
 */
export function getEffectiveDisallowedTools(agentName: string): string[] {
  const config = getAgentConfig(agentName)
  const explicit = config?.disallowedTools ?? []

  // Category-based defaults
  const category = AGENT_CATEGORY[agentName]
  const categoryDefaults = category ? CATEGORY_DEFAULTS[category]?.disallowedTools ?? [] : []

  // Merge: explicit takes priority, add category defaults that aren't overridden
  const merged = new Set([...explicit, ...categoryDefaults])

  // If agent has allowedTools, everything NOT in allowed is implicitly disallowed
  // (but we don't generate that list — too broad)

  return [...merged]
}

export function clearAgentConfigCache(): void {
  _cache.clear()
}
