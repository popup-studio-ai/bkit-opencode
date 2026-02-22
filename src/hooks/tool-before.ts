import type { PluginInput } from "@opencode-ai/plugin"
import { classifyTask, getPdcaLevel } from "../lib/task/classification"
import { debugLog } from "../lib/core/debug"
import { extractFeature, isEnvFile } from "../lib/core/file"
import { getActiveContext, getActiveSkill, setActiveSkill, setContextMetadata, getContextMetadata } from "../lib/task/context"
import { getSkillConfig } from "../lib/skill-orchestrator"
import { addTeammate, readAgentState } from "../lib/team/state-writer"
import { isDangerousCommand, normalizeCommand, getBlockingPhase } from "../lib/security/rules"
import { tmpdir } from "os"
import { join } from "path"

/**
 * Set of temp file paths created by write-blocking.
 * Exported so tool-after can clean them up immediately after execution.
 * H-2 fix: Prevents orphaned temp files from accumulating.
 */
export const blockedWritePaths = new Set<string>()

export function createToolBeforeHandler(input: PluginInput) {
  return async (
    toolInput: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => {
    const tool = toolInput.tool.toLowerCase()

    try {
      // Skill activation: store allowed-tools in context metadata
      if (tool === "skill") {
        const skillName = output.args?.skill || output.args?.name || ""
        const cleanName = skillName.replace(/^bkit:/, "")
        setActiveSkill(cleanName)

        const config = getSkillConfig(cleanName)
        const allowedTools = config?.["allowed-tools"] || []
        if (allowedTools.length > 0) {
          setContextMetadata("allowedTools", allowedTools)
          debugLog("ToolBefore", "Skill allowed-tools set", { skill: cleanName, tools: allowedTools })
        }
      }

      // Allowed-tools enforcement: block tools not in active skill's allowed list
      const activeSkill = getActiveSkill()
      if (activeSkill && tool !== "skill") {
        const allowedTools = getContextMetadata<string[]>("allowedTools")
        if (allowedTools && allowedTools.length > 0) {
          const toolName = toolInput.tool // preserve original casing
          const isAllowed = allowedTools.some(
            t => t.toLowerCase() === tool || t.toLowerCase() === toolName.toLowerCase()
          )
          if (!isAllowed) {
            debugLog("ToolBefore", "Tool blocked by allowed-tools", { skill: activeSkill, tool: toolName, allowed: allowedTools })
            if (tool === "bash") {
              const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_.-]/g, "")
              output.args.command = `echo '[bkit] Tool ${safeName(toolName)} not in allowed-tools for skill ${safeName(activeSkill)}'`
            } else if (tool === "write" && output.args?.file_path) {
              const tmpPath = join(tmpdir(), `.bkit-blocked-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
              blockedWritePaths.add(tmpPath)
              output.args.file_path = tmpPath
            } else if (tool === "edit") {
              output.args.new_string = output.args.old_string
            }
            return // skip further processing for blocked tool
          }
        }
      }

      // Pre-Write/Edit: Log PDCA-relevant writes and classify content size
      if (tool === "write" || tool === "edit") {
        const filePath = output.args?.file_path || output.args?.path || ""

        // Warn on env file writes (potential secret leak)
        if (isEnvFile(filePath)) {
          debugLog("ToolBefore", "Env file write detected - check for secrets", { tool, filePath })
        }

        if (filePath.includes("00-research/") || filePath.includes("01-plan/") || filePath.includes("02-design/")) {
          debugLog("ToolBefore", "PDCA document write detected", { tool, filePath })
        }

        // Extract feature name from file path for context
        const feature = extractFeature(filePath)
        if (feature) {
          debugLog("ToolBefore", "Feature detected from path", { feature, filePath })
        }

        // Classify content size for PDCA level guidance
        const content = output.args?.content || output.args?.new_string || ""
        if (content.length > 200) {
          const classification = classifyTask(content)
          const pdcaLevel = getPdcaLevel(classification)
          debugLog("ToolBefore", "Content classified", { classification, pdcaLevel, chars: content.length })
        }

        // PDCA phase-based write restriction (H-1: uses shared rules module)
        const blockingPhase = await getBlockingPhase(filePath, input.directory)
        if (blockingPhase) {
          if (tool === "write" && output.args?.file_path) {
            // H-2: Redirect write to temp file instead of neutering content
            const tmpPath = join(tmpdir(), `.bkit-blocked-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
            blockedWritePaths.add(tmpPath)
            output.args.file_path = tmpPath
            debugLog("ToolBefore", "Blocked source code write — redirected to temp", { phase: blockingPhase, original: filePath, tmpPath })
          } else if (tool === "edit" && output.args?.new_string !== undefined) {
            // No-op edit: replace with same string
            output.args.new_string = output.args.old_string
            debugLog("ToolBefore", "Blocked source code edit — no-op", { phase: blockingPhase, filePath })
          }
        }
      }

      // Pre-Bash: Block dangerous commands via args mutation (H-1: uses shared rules, H-3: normalized matching)
      if (tool === "bash") {
        const command = output.args?.command || ""
        if (isDangerousCommand(command)) {
          output.args.command = `echo '[bkit] Dangerous command blocked'`
          debugLog("ToolBefore", "Blocked dangerous command", { command: command.slice(0, 100) })
        }
      }

      // SubagentStart detection: when a Task tool is invoked, register the
      // spawned agent as a teammate in the team state (if team mode is active).
      if (tool === "agent") {
        const agentState = readAgentState(input.directory)
        if (agentState?.enabled) {
          const subagentType = output.args?.subagent_type || output.args?.agentType || "general"
          const description = output.args?.description || output.args?.prompt?.slice(0, 80) || ""
          const cleanName = subagentType.replace(/^bkit:/, "")

          const alreadyRegistered = agentState.teammates.some(
            (t) =>
              (t.name === cleanName || t.name === subagentType) &&
              (t.status === "working" || t.status === "spawning"),
          )

          if (alreadyRegistered) {
            debugLog("ToolBefore", "SubagentStart - already registered by team-assign, skipping", {
              agent: cleanName,
            })
          } else {
            addTeammate(
              {
                name: cleanName,
                role: cleanName,
                model: output.args?.model || "sonnet",
                currentTask: description,
              },
              input.directory,
            )
            debugLog("ToolBefore", "SubagentStart - auto-registered teammate", {
              agent: cleanName,
              description: description.slice(0, 60),
            })
          }
        }
      }

      // Log active context for debugging
      const ctx = getActiveContext()
      if (ctx.skill || ctx.agent) {
        debugLog("ToolBefore", "Active context", { skill: ctx.skill, agent: ctx.agent, tool })
      }
    } catch (e: any) {
      debugLog("ToolBefore", "Handler error (non-fatal)", { error: e.message })
    }
  }
}
