/**
 * bkit-level-info Tool
 *
 * OpenCode-unique tool: LLM can directly query project level, applicable phases,
 * and level-specific guidance. Also supports setting the level.
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import {
  detectLevel,
  autoDetectLevel,
  storeLevel,
  normalizeLevel,
  LEVEL_PHASE_MAP,
  getRequiredPhases,
  getLevelPhaseGuide,
  canSkipPhase,
  isPhaseApplicable,
  getNextPhaseForLevel,
} from "../lib/pdca/level"
import type { ProjectLevel } from "../lib/pdca/level"
import type { PdcaPhase } from "../lib/pdca/phase"
import { cache } from "../lib/core/cache"

export function createLevelInfoTool(input: PluginInput) {
  return tool({
    description: "Get or set project level, applicable PDCA phases, and level-specific guidance.",
    args: {
      action: tool.schema
        .enum(["detect", "phases", "guide", "check-phase", "set"])
        .describe("Action: detect=get level, phases=list phases, guide=get guidance, check-phase=check if phase applies, set=store user-selected level"),
      phase: tool.schema
        .string()
        .optional()
        .describe("Phase name for check-phase action (research/plan/design/do/check/act)"),
      level: tool.schema
        .string()
        .optional()
        .describe("Level for set action (Starter/Dynamic/Enterprise)"),
    },
    async execute(args) {
      // Handle "set" action first (doesn't need current level)
      if (args.action === "set") {
        const newLevel = normalizeLevel(args.level)
        if (!newLevel) {
          return `Error: level must be one of: Starter, Dynamic, Enterprise (got "${args.level}")`
        }
        storeLevel(input.directory, newLevel)
        // Invalidate system prompt cache so new level takes effect immediately
        cache.invalidate("bkit-system-prompt")
        return [
          `# Project Level Set: ${newLevel}`,
          "",
          `Level "${newLevel}" has been stored in .bkit-memory.json.`,
          `All future sessions will use this level.`,
          "",
          getLevelPhaseGuide(newLevel),
        ].join("\n")
      }

      const level = detectLevel(input.directory)

      if (!level) {
        const suggested = autoDetectLevel(input.directory)
        return [
          "# Project Level: NOT SET",
          "",
          `Auto-detected suggestion: **${suggested}**`,
          "",
          "Please ask the user to choose a level using AskUserQuestion:",
          "- Starter: Static websites, portfolios, landing pages",
          "- Dynamic: Fullstack apps with auth, database, API",
          "- Enterprise: Microservices, Kubernetes, Terraform",
          "",
          'Then call: bkit-level-info(action="set", level="chosen_level")',
        ].join("\n")
      }

      switch (args.action) {
        case "detect":
          return [
            `# Project Level: ${level}`,
            "",
            JSON.stringify({
              level,
              directory: input.directory,
              phaseConfig: LEVEL_PHASE_MAP[level],
            }, null, 2),
          ].join("\n")

        case "phases": {
          const required = getRequiredPhases(level)
          const config = LEVEL_PHASE_MAP[level]
          return [
            `# PDCA Phases for ${level}`,
            "",
            `Required: ${required.join(" → ")}`,
            config.optional.length > 0 ? `Optional: ${config.optional.join(", ")}` : null,
            config.skippable.length > 0 ? `Skippable: ${config.skippable.join(", ")}` : null,
          ].filter(Boolean).join("\n")
        }

        case "guide":
          return [
            `# ${level} Level Guide`,
            "",
            getLevelPhaseGuide(level),
          ].join("\n")

        case "check-phase": {
          if (!args.phase) {
            return "Error: Phase parameter required for check-phase action"
          }
          const phase = args.phase as PdcaPhase
          const applicable = isPhaseApplicable(level, phase)
          const skippable = canSkipPhase(level, phase)
          const next = getNextPhaseForLevel(level, phase)
          return [
            `# Phase "${phase}" for ${level}`,
            "",
            JSON.stringify({
              phase,
              level,
              applicable,
              skippable,
              nextPhase: next,
            }, null, 2),
          ].join("\n")
        }

        default:
          return `Error: Unknown action: ${args.action}`
      }
    },
  })
}
