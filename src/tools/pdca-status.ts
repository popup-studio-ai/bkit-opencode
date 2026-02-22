/**
 * bkit-pdca-status Tool
 *
 * Custom tool that shows PDCA workflow status, next phase guidance,
 * and feature history. Registered as "bkit-pdca-status" in OpenCode.
 *
 * CRITICAL: The "update" action is the PRIMARY mechanism for phase tracking
 * in OpenCode. Unlike Claude Code where the Skill tool triggers tool-after
 * hooks, OpenCode skills don't trigger tool.execute.after. So the PDCA skill
 * MUST explicitly call this tool with action="update" to record phase changes.
 * The hook-based file-write detection is a secondary backup only.
 */

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  getPdcaStatus,
  formatPdcaStatus,
  getArchivedFeatures,
  syncStatusWithDocs,
  updateFeaturePhase,
  readBkitMemory,
  writeBkitMemory,
  savePdcaStatus,
  applyPhaseToStatus,
  applyDocumentToStatus,
} from "../lib/pdca/status"
import { detectLevel } from "../lib/pdca/level"
import { getNextPhaseGuidance } from "../lib/pdca/phase"
import { cache } from "../lib/core/cache"
import { debugLog } from "../lib/core/debug"
import { autoCommitPhaseChange } from "../lib/core/auto-commit"
import { existsSync, writeFileSync } from "fs"
import { join } from "path"
import { spawnSync } from "child_process"

const DEFAULT_GITIGNORE = `# Dependencies
node_modules/
.pnp.*

# Build
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# bkit state (local only)
.bkit/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
`

/**
 * Ensure the project directory has a git repo initialized.
 * Creates .gitignore with sensible defaults if missing.
 * Idempotent — does nothing if .git/ already exists.
 */
function ensureGitRepo(directory: string): void {
  const gitDir = join(directory, ".git")
  if (existsSync(gitDir)) return

  try {
    const result = spawnSync("git", ["init"], { cwd: directory, encoding: "utf-8", timeout: 5000 })
    if (result.status === 0) {
      debugLog("PdcaStatus", "Git repo initialized", { directory })

      // Create .gitignore if it doesn't exist
      const gitignorePath = join(directory, ".gitignore")
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, DEFAULT_GITIGNORE)
        debugLog("PdcaStatus", ".gitignore created", { directory })
      }
    }
  } catch (e: any) {
    debugLog("PdcaStatus", "Git init failed (non-fatal)", { error: e?.message })
  }
}

export function createPdcaStatusTool(input: PluginInput) {
  return tool({
    description:
      "PDCA workflow status management. IMPORTANT: You MUST call action='update' at the start of each PDCA phase to record progress. Also use: 'status' to view, 'next' for guidance, 'history' for archives, 'sync' to recover from docs.",
    args: {
      feature: tool.schema
        .string()
        .optional()
        .describe("Feature name. Required for 'update' action. Shows primary feature if omitted for other actions."),
      action: tool.schema
        .enum(["status", "next", "history", "update", "sync"])
        .optional()
        .describe(
          "Action: 'status' (view), 'next' (guidance), 'history' (archives), 'update' (set phase — MUST call at each phase start), 'sync' (recover status from docs)"
        ),
      phase: tool.schema
        .string()
        .optional()
        .describe("Phase for 'update' action: research/plan/design/do/check/act/completed"),
      docPath: tool.schema
        .string()
        .optional()
        .describe("Document path for 'update' action (e.g., docs/01-plan/features/foo.plan.md)"),
    },
    async execute(args, ctx) {
      // Use ctx.directory if available, fall back to plugin input.directory
      const directory = ctx?.directory || input.directory
      const action = args.action ?? "status"

      // Handle "update" action FIRST — this is the critical path for phase tracking
      if (action === "update") {
        const featureName = args.feature
        const phase = args.phase
        if (!featureName) {
          return "Error: feature is required for update action. Example: bkit-pdca-status(action='update', feature='my-feature', phase='plan')"
        }
        if (!phase) {
          return "Error: phase is required for update action. Valid phases: research, plan, design, do, check, act, completed"
        }

        const validPhases = ["research", "plan", "design", "do", "check", "act", "completed", "archived"]
        if (!validPhases.includes(phase)) {
          return `Error: invalid phase "${phase}". Must be one of: ${validPhases.join(", ")}`
        }

        try {
          // Auto-init git if not already a repo (runs once, idempotent)
          ensureGitRepo(directory)

          const status = await getPdcaStatus(directory)

          // Phase regression protection: don't move backwards
          const existing = status.features[featureName]
          if (existing) {
            const phaseOrder = ["research", "plan", "design", "do", "check", "act", "completed"]
            const currentIdx = phaseOrder.indexOf(existing.phase)
            const targetIdx = phaseOrder.indexOf(phase)
            if (targetIdx >= 0 && currentIdx >= 0 && targetIdx < currentIdx) {
              return [
                `# Phase Update Skipped (regression blocked)`,
                "",
                `Feature "${featureName}" is already at **${existing.phase}** (phase ${currentIdx}).`,
                `Requested phase **${phase}** (phase ${targetIdx}) is earlier.`,
                "",
                `Current status preserved. Use action='status' to view.`,
              ].join("\n")
            }
          }

          // Apply phase update
          applyPhaseToStatus(status, phase, featureName)

          // Track document path if provided
          if (args.docPath) {
            const docTypeMap: Record<string, "plan" | "design" | "analysis" | "report" | "research"> = {
              research: "research",
              plan: "plan",
              design: "design",
              check: "analysis",
              act: "analysis",
              completed: "report",
            }
            const docType = docTypeMap[phase]
            if (docType) {
              applyDocumentToStatus(status, featureName, docType, args.docPath)
            }
          }

          await savePdcaStatus(directory, status)

          // Also update bkit-memory.json
          const memory = readBkitMemory(directory) ?? {}
          memory.feature = featureName
          memory.phase = phase
          memory.lastUpdated = new Date().toISOString()
          if (!memory.startedAt) {
            memory.startedAt = new Date().toISOString()
          }
          writeBkitMemory(directory, memory)

          // Invalidate system prompt cache
          cache.invalidate("bkit-system-prompt")

          debugLog("PdcaStatus", "Phase updated via tool", { feature: featureName, phase })

          // Auto-commit phase change
          autoCommitPhaseChange(directory, phase, featureName, "pdca")

          const formatted = formatPdcaStatus(status, featureName)
          return [
            `# Phase Updated: ${featureName} → ${phase}`,
            "",
            formatted,
          ].join("\n")
        } catch (e: any) {
          return `Error updating phase: ${e?.message}`
        }
      }

      // Handle "sync" action — force sync from docs
      if (action === "sync") {
        const synced = await syncStatusWithDocs(directory)
        const status = await getPdcaStatus(directory)
        const formatted = formatPdcaStatus(status)
        return [
          `# PDCA Status Synced`,
          "",
          synced ? "Documents found and status updated." : "No new documents to sync.",
          "",
          formatted,
        ].join("\n")
      }

      // Auto-sync: pick up PDCA docs created via bash (bypassing tool-after hooks)
      await syncStatusWithDocs(directory)

      const status = await getPdcaStatus(directory)
      const level = detectLevel(directory)

      if (action === "history") {
        const archived = getArchivedFeatures(status)
        const entries = Object.entries(archived)
        if (entries.length === 0) {
          return [
            "# PDCA History",
            "",
            "No archived features found.",
            "",
            `Active features: ${status.activeFeatures.length > 0 ? status.activeFeatures.join(", ") : "none"}`,
          ].join("\n")
        }

        const list = entries
          .map(([name, f]) => {
            return `- **${name}**: archived ${f.archivedAt ?? "unknown"} → ${f.archivedTo ?? "N/A"}`
          })
          .join("\n")

        return [
          "# PDCA History",
          "",
          `## Archived Features (${entries.length})`,
          list,
          "",
          `## Active Features (${status.activeFeatures.length})`,
          status.activeFeatures.length > 0
            ? status.activeFeatures.join(", ")
            : "none",
        ].join("\n")
      }

      const featureName = args.feature ?? status.primaryFeature
      const featureData = featureName
        ? status.features[featureName]
        : undefined

      if (action === "next") {
        const guidance = getNextPhaseGuidance(status, featureName)
        return [
          "# Next Phase Guidance",
          "",
          `**Feature:** ${featureName ?? "none"}`,
          `**Current Phase:** ${featureData?.phase ?? "none"}`,
          `**Match Rate:** ${featureData?.matchRate ?? "N/A"}`,
          "",
          guidance,
        ].join("\n")
      }

      // Default: status
      const formatted = formatPdcaStatus(status, featureName)
      return [
        "# PDCA Status",
        "",
        `**Project Level:** ${level ?? "NOT SET (use bkit-level-info action=set to configure)"}`,
        "",
        formatted,
      ].join("\n")
    },
  })
}
