/**
 * Skill Orchestrator
 * Manages skill lifecycle, frontmatter parsing, and agent-skill binding.
 * Ported from bkit-claude-code lib/skill-orchestrator.js
 */

import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { debugLog } from "./core/debug"
import { getPluginRoot } from "./core/platform"
import { setActiveSkill, clearActiveContext } from "./task/context"
import { resolveImports } from "./import-resolver"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SKILL_CACHE_TTL = 30_000 // 30 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillFrontmatter {
  name?: string
  description?: string
  imports?: string[]
  agent?: string
  agents?: Record<string, string>
  "allowed-tools"?: string[]
  "user-invocable"?: boolean
  "argument-hint"?: string
  "next-skill"?: string
  "pdca-phase"?: string
  "task-template"?: string
  hooks?: Record<string, unknown[]>
  [key: string]: unknown
}

export interface SkillConfig extends SkillFrontmatter {
  body: string
}

export interface AgentsMapping {
  default: string | null
  _isMultiBinding: boolean
  [action: string]: string | boolean | null
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const _skillConfigCache = new Map<string, { config: SkillConfig; timestamp: number }>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseSkillFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  try {
    const yamlStr = match[1]
    const frontmatter: SkillFrontmatter = {}

    // Parse imports array
    const importsMatch = yamlStr.match(/imports:\s*\n((?:\s+-\s+.+\n?)+)/)
    if (importsMatch) {
      frontmatter.imports = importsMatch[1]
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("-"))
        .map(line => line.replace(/^-\s+/, "").trim())
    }

    // Parse allowed-tools array
    const toolsMatch = yamlStr.match(/allowed-tools:\s*\n((?:\s+-\s+.+\n?)+)/)
    if (toolsMatch) {
      frontmatter["allowed-tools"] = toolsMatch[1]
        .split("\n")
        .map(line => line.trim())
        .filter(line => line.startsWith("-"))
        .map(line => line.replace(/^-\s+/, "").trim())
    }

    // Parse simple key-value pairs
    for (const line of yamlStr.split("\n")) {
      if (line.match(/^description:\s*\|/)) continue
      const kvMatch = line.match(/^([\w-]+):\s*(.+)$/)
      if (kvMatch && !["imports", "allowed-tools", "hooks", "agents"].includes(kvMatch[1])) {
        let value: unknown = kvMatch[2].trim()
        if (typeof value === "string") {
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = (value as string).slice(1, -1)
          }
          if (value === "true") value = true
          else if (value === "false") value = false
          else if (value === "null") value = null
        }
        ;(frontmatter as any)[kvMatch[1]] = value
      }
    }

    // Parse agents section
    const agentsMatch = yamlStr.match(/agents:\s*\n((?:\s+\w+:\s*.+\n?)+)/)
    if (agentsMatch) {
      const agentsObj: Record<string, string> = {}
      for (const line of agentsMatch[1].split("\n").map(l => l.trim()).filter(l => l.length > 0)) {
        const agentKV = line.match(/^(\w+):\s*(.+)$/)
        if (agentKV) {
          let val = agentKV[2].trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          agentsObj[agentKV[1]] = val
        }
      }
      frontmatter.agents = agentsObj
    }

    return { frontmatter, body: match[2] }
  } catch (e: any) {
    debugLog("SkillOrchestrator", "Frontmatter parse error", { error: e.message })
    return { frontmatter: {}, body: content }
  }
}

export function getSkillConfig(skillName: string): SkillConfig | null {
  // Check cache
  const cached = _skillConfigCache.get(skillName)
  if (cached && Date.now() - cached.timestamp < SKILL_CACHE_TTL) {
    return cached.config
  }

  const pluginRoot = getPluginRoot()
  const skillPath = join(pluginRoot, "..", "skills", skillName, "SKILL.md")

  if (!existsSync(skillPath)) {
    debugLog("SkillOrchestrator", "Skill not found", { skillName, path: skillPath })
    return null
  }

  try {
    const content = readFileSync(skillPath, "utf8")
    const { frontmatter, body } = parseSkillFrontmatter(content)

    const config: SkillConfig = {
      name: frontmatter.name || skillName,
      description: (frontmatter.description as string) || "",
      imports: frontmatter.imports || [],
      agent: (frontmatter.agent as string) || undefined,
      agents: frontmatter.agents || undefined,
      "allowed-tools": frontmatter["allowed-tools"] || [],
      "user-invocable": frontmatter["user-invocable"] !== undefined ? frontmatter["user-invocable"] as boolean : undefined,
      "argument-hint": (frontmatter["argument-hint"] as string) || undefined,
      "next-skill": (frontmatter["next-skill"] as string) || undefined,
      "pdca-phase": (frontmatter["pdca-phase"] as string) || undefined,
      "task-template": (frontmatter["task-template"] as string) || undefined,
      body,
    }

    // Validate imports (debug-only): check that import paths resolve correctly.
    // Note: resolved content is NOT injected into body (OpenCode limitation).
    // Files in skill directory are auto-included via <skill_files>.
    if (config.imports && config.imports.length > 0) {
      const skillFilePath = join(pluginRoot, "..", "skills", skillName, "SKILL.md")
      const { errors } = resolveImports({ imports: config.imports }, skillFilePath)
      if (errors.length > 0) {
        debugLog("SkillOrchestrator", "Import resolution errors", { skillName, errors })
      }
    }

    _skillConfigCache.set(skillName, { config, timestamp: Date.now() })
    return config
  } catch (e: any) {
    debugLog("SkillOrchestrator", "Failed to load skill", { skillName, error: e.message })
    return null
  }
}

export function parseAgentsField(frontmatter: { agents?: Record<string, string>; agent?: string }): AgentsMapping {
  if (frontmatter.agents && typeof frontmatter.agents === "object") {
    return { ...frontmatter.agents, _isMultiBinding: true, default: frontmatter.agents.default || null }
  }
  if (frontmatter.agent && typeof frontmatter.agent === "string") {
    return { default: frontmatter.agent, _isMultiBinding: false }
  }
  return { default: null, _isMultiBinding: false }
}

export function getAgentForAction(skillName: string, action: string): string | null {
  const config = getSkillConfig(skillName)
  if (!config) return null
  const agents = parseAgentsField(config)
  return (agents[action] as string) || agents.default || null
}

export function getLinkedAgents(skillName: string): string[] {
  const config = getSkillConfig(skillName)
  if (!config) return []
  const agents = parseAgentsField(config)
  const names = Object.entries(agents)
    .filter(([key, value]) => key !== "_isMultiBinding" && typeof value === "string" && value)
    .map(([, value]) => value as string)
  return [...new Set(names)]
}

export function isMultiBindingSkill(skillName: string): boolean {
  const config = getSkillConfig(skillName)
  if (!config) return false
  return parseAgentsField(config)._isMultiBinding
}

export function getNextStepMessage(nextSkillName: string): string {
  const messages: Record<string, string> = {
    "phase-1-schema": "Define schema and terminology.",
    "phase-2-convention": "Define coding conventions.",
    "phase-3-mockup": "Create mockups.",
    "phase-4-api": "Design APIs.",
    "phase-5-design-system": "Build design system.",
    "phase-6-ui-integration": "Implement UI.",
    "phase-7-seo-security": "Review SEO/security.",
    "phase-8-review": "Run code review.",
    "phase-9-deployment": "Prepare deployment.",
  }
  return messages[nextSkillName] || `Next step: ${nextSkillName}`
}

export function clearCache(): void {
  _skillConfigCache.clear()
}

export function getCacheStats(): { size: number; entries: string[] } {
  return { size: _skillConfigCache.size, entries: Array.from(_skillConfigCache.keys()) }
}

// ---------------------------------------------------------------------------
// Skill Orchestration Hooks (OpenCode-optimized: inline in plugin hooks)
// ---------------------------------------------------------------------------

export interface SkillHookResult {
  shouldProceed: boolean
  injectedContext?: string
  modifiedArgs?: string
}

/**
 * Pre-skill orchestration: prepare context before skill execution.
 * Sets active skill context and resolves any agent delegation.
 * OpenCode advantage: called inline from chat.message hook (faster than separate script).
 *
 * @deprecated Dead code — not called from any hook. Functionality is wired directly:
 *   - setActiveSkill → tool-before.ts (skill handler)
 *   - allowed-tools → tool-before.ts (enforcement check)
 *   - agent delegation → tool-after.ts (skill handler)
 *   Retained for reference; may be removed in a future cleanup pass.
 */
export function orchestrateSkillPre(skillName: string, args?: string): SkillHookResult {
  const config = getSkillConfig(skillName)
  if (!config) {
    debugLog("SkillOrchestrator", "Skill not found for pre-orchestration", { skillName })
    return { shouldProceed: true }
  }

  // Set active context
  setActiveSkill(skillName)

  // Resolve agent if skill has agent delegation
  const agents = parseAgentsField(config)
  let injectedContext: string | undefined

  if (agents.default || agents._isMultiBinding) {
    const action = args?.split(/\s+/)[0] || "default"
    const agent = (agents[action] as string) || agents.default
    if (agent) {
      injectedContext = `[bkit] Skill "${skillName}" delegates to agent: ${agent}`
    }
  }

  debugLog("SkillOrchestrator", "Pre-orchestration complete", {
    skillName,
    hasAgent: !!injectedContext,
    args: args?.slice(0, 50),
  })

  return { shouldProceed: true, injectedContext, modifiedArgs: args }
}

/**
 * Post-skill orchestration: guide to next step after skill completes.
 * OpenCode advantage: returns structured data for hook to inject into output.
 *
 * @deprecated Dead code — not called from any hook. Functionality is wired directly:
 *   - next-skill guidance → tool-after.ts (skill orchestration block)
 *   - task-template → tool-after.ts (task metadata attachment)
 *   - clearActiveContext → tool-after.ts + message.ts
 *   Retained for reference; may be removed in a future cleanup pass.
 */
export function orchestrateSkillPost(skillName: string): {
  nextSkill: string | null
  guidance: string
  autoTrigger: boolean
} {
  const config = getSkillConfig(skillName)
  if (!config) {
    clearActiveContext()
    return { nextSkill: null, guidance: "", autoTrigger: false }
  }

  const nextSkill = config["next-skill"] || null
  const guidance = nextSkill ? getNextStepMessage(nextSkill) : ""

  // Auto-trigger if PDCA phase skill (phase-1 through phase-9)
  const autoTrigger = !!nextSkill && /^phase-\d/.test(nextSkill)

  clearActiveContext()

  debugLog("SkillOrchestrator", "Post-orchestration", {
    skillName,
    nextSkill,
    autoTrigger,
  })

  return { nextSkill, guidance, autoTrigger }
}
