/**
 * Shared security rules for permission.ts and tool-before.ts.
 *
 * H-1 fix: Single source of truth for dangerous command patterns
 * and PDCA phase-based write restrictions. Both hook handlers
 * import from here to prevent rule divergence.
 */

import { getPdcaStatus } from "../pdca/status"

// ---------------------------------------------------------------------------
// Dangerous bash command patterns
// ---------------------------------------------------------------------------

/** Commands that should be hard-denied (destructive, irreversible). */
export const DANGEROUS_COMMANDS: RegExp[] = [
  /rm\s+-rf\s+[/~]/,
  /git\s+push\s+--force/,
  /git\s+push\s+-f\b/,
  /drop\s+(database|table)/i,
]

/** Commands that should prompt for confirmation (risky but sometimes needed). */
export const RISKY_COMMANDS: RegExp[] = [
  /git\s+reset\s+--hard/,
  /rm\s+-r\b/,
  /npm\s+publish/,
]

/**
 * Normalize a command string for pattern matching.
 * H-3 fix: Collapse multiple whitespace to single space to prevent
 * bypass via extra spaces (e.g. "rm  -rf  /").
 */
export function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim()
}

/**
 * Check if a command matches any dangerous patterns.
 * Applies normalization before matching.
 */
export function isDangerousCommand(command: string): boolean {
  const normalized = normalizeCommand(command)
  return DANGEROUS_COMMANDS.some((p) => p.test(normalized))
}

/**
 * Check if a command matches any risky patterns.
 * Applies normalization before matching.
 */
export function isRiskyCommand(command: string): boolean {
  const normalized = normalizeCommand(command)
  return RISKY_COMMANDS.some((p) => p.test(normalized))
}

// ---------------------------------------------------------------------------
// PDCA phase-based write restrictions
// ---------------------------------------------------------------------------

/** Files that are always writable regardless of PDCA phase. */
export function isStateFile(filePath: string): boolean {
  return (
    filePath.includes(".pdca-status.json") ||
    filePath.includes(".bkit-memory") ||
    filePath.includes(".bkit-agent-state")
  )
}

/** PDCA documentation paths — always writable. */
export function isDocFile(filePath: string): boolean {
  return filePath.includes("/docs/") || filePath.startsWith("docs/")
}

/**
 * Check if a file write should be blocked based on current PDCA phase.
 * Returns the blocking phase name if blocked, null if allowed.
 */
export async function getBlockingPhase(
  filePath: string,
  directory: string,
): Promise<string | null> {
  if (isStateFile(filePath) || isDocFile(filePath)) return null

  const status = await getPdcaStatus(directory)
  const feature = status?.primaryFeature
  if (!feature) return null

  const phase = status.features?.[feature]?.phase
  if (phase === "plan" || phase === "check") {
    return phase
  }
  return null
}
