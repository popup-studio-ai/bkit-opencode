import type { PluginInput } from "@opencode-ai/plugin"
import { debugLog } from "../lib/core/debug"
import { isDangerousCommand, isRiskyCommand, normalizeCommand, isStateFile, isDocFile, getBlockingPhase } from "../lib/security/rules"

/**
 * OpenCode Permission object shape (from @opencode-ai/sdk Permission type).
 * Passed to "permission.ask" hook via Plugin.trigger() in permission/index.ts.
 */
interface PermissionInfo {
  id: string
  type: string
  pattern?: string | string[]
  sessionID: string
  messageID: string
  callID?: string
  title: string
  metadata: Record<string, unknown>
  time: { created: number }
}

/**
 * Permission hook handler.
 *
 * NOTE: This hook is currently DEAD CODE in OpenCode.
 * The active permission system (PermissionNext in permission/next.ts) does NOT call
 * Plugin.trigger("permission.ask"). Only the legacy Permission system wires it.
 *
 * Kept for forward compatibility. Actual protection is in tool-before.ts.
 * H-1 fix: Uses shared rules module to keep patterns in sync with tool-before.ts.
 */
export function createPermissionHandler(input: PluginInput) {
  return async (
    perm: PermissionInfo,
    output: { status: "ask" | "deny" | "allow" },
  ) => {
    try {
      if (!perm || !perm.type) return

      const permType = perm.type
      const rawPattern = perm.pattern
      const patterns: string[] = Array.isArray(rawPattern)
        ? rawPattern
        : typeof rawPattern === "string"
          ? [rawPattern]
          : []

      // Dangerous bash commands: hard deny (H-1: shared rules)
      if (permType === "bash") {
        const allPatterns = patterns.join(" ")
        if (isDangerousCommand(allPatterns)) {
          output.status = "deny"
          debugLog("Permission", "Denied dangerous command", { pattern: patterns })
          return
        }
        if (isRiskyCommand(allPatterns)) {
          output.status = "ask"
          return
        }
      }

      // PDCA phase-based restrictions (H-1: shared rules)
      if (permType === "edit" || permType === "write") {
        const hasStateFile = patterns.some((p) => isStateFile(p))
        const hasDocFile = patterns.some((p) => isDocFile(p))
        if (!hasStateFile && !hasDocFile) {
          // Check any pattern for blocking phase
          for (const p of patterns) {
            const blockingPhase = await getBlockingPhase(p, input.directory)
            if (blockingPhase) {
              output.status = "deny"
              debugLog("Permission", "Denied source code write in read-only phase", { phase: blockingPhase, patterns })
              return
            }
          }
        }
      }
    } catch (e: any) {
      debugLog("Permission", "Handler error (non-fatal)", { error: e.message })
    }
  }
}
