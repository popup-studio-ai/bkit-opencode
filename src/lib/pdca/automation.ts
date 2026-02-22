// PDCA Automation Module
// Handles PDCA phase auto-advance, auto-trigger, and automation level management.
// Ported from bkit-claude-code lib/pdca/automation.js to TypeScript for OpenCode.

import { debugLog } from "../core/debug"
import { loadBkitConfig } from "../core/config"
import { getPdcaStatus, updateFeaturePhase } from "./status"
import type { PdcaFeature } from "./status"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutomationLevel = "manual" | "semi-auto" | "full-auto"

export interface AutoTrigger {
  skill: string
  args: string
}

export interface PhaseAdvanceResult {
  feature: string
  phase: string
  trigger: AutoTrigger | null
}

// ---------------------------------------------------------------------------
// Automation Level
// ---------------------------------------------------------------------------

export function getAutomationLevel(projectDir?: string): AutomationLevel {
  const envLevel = process.env.BKIT_PDCA_AUTOMATION as AutomationLevel | undefined
  if (envLevel && ["manual", "semi-auto", "full-auto"].includes(envLevel)) {
    return envLevel
  }
  // Default to semi-auto
  return "semi-auto"
}

export function isFullAutoMode(projectDir?: string): boolean {
  return getAutomationLevel(projectDir) === "full-auto"
}

// ---------------------------------------------------------------------------
// Auto-Advance Logic
// ---------------------------------------------------------------------------

export function shouldAutoAdvance(phase: string, projectDir?: string): boolean {
  const level = getAutomationLevel(projectDir)

  if (level === "manual") return false

  const reviewCheckpoints = ["design"]

  if (level === "full-auto") {
    return !reviewCheckpoints.includes(phase)
  }

  // semi-auto: only auto-advance from check to act (when matchRate < 90)
  return phase === "check"
}

export function generateAutoTrigger(
  currentPhase: string,
  context: { feature?: string; matchRate?: number } = {},
): AutoTrigger | null {
  if (!shouldAutoAdvance(currentPhase)) return null

  const feature = context.feature || ""
  const phaseMap: Record<string, AutoTrigger> = {
    research: { skill: "pdca", args: `plan ${feature}` },
    plan: { skill: "pdca", args: `design ${feature}` },
    design: { skill: "pdca", args: `do ${feature}` },
    do: { skill: "pdca", args: `analyze ${feature}` },
    check:
      (context.matchRate ?? 0) >= 90
        ? { skill: "pdca", args: `report ${feature}` }
        : { skill: "pdca", args: `iterate ${feature}` },
    act: { skill: "pdca", args: `analyze ${feature}` },
  }

  return phaseMap[currentPhase] ?? null
}

// ---------------------------------------------------------------------------
// Auto-Start PDCA
// ---------------------------------------------------------------------------

export async function shouldAutoStartPdca(
  feature: string,
  charCount: number,
  projectDir: string,
): Promise<boolean> {
  const status = await getPdcaStatus(projectDir)
  if (status?.features?.[feature]) return false

  const threshold = 100
  return charCount >= threshold
}

// ---------------------------------------------------------------------------
// Auto-Advance Phase
// ---------------------------------------------------------------------------

export async function autoAdvancePdcaPhase(
  feature: string,
  currentPhase: string,
  result: { matchRate?: number } = {},
  projectDir?: string,
): Promise<PhaseAdvanceResult | null> {
  if (!shouldAutoAdvance(currentPhase, projectDir)) {
    debugLog("PDCA", "Auto-advance skipped", { phase: currentPhase })
    return null
  }

  const nextPhaseMap: Record<string, string> = {
    research: "plan",
    plan: "design",
    design: "do",
    do: "check",
    check: (result.matchRate ?? 0) >= 90 ? "completed" : "act",
    act: "check",
  }

  const nextPhase = nextPhaseMap[currentPhase]
  if (!nextPhase || !projectDir) return null

  await updateFeaturePhase(projectDir, nextPhase, feature)

  debugLog("PDCA", "Auto-advanced phase", {
    feature,
    from: currentPhase,
    to: nextPhase,
  })

  return {
    feature,
    phase: nextPhase,
    trigger: generateAutoTrigger(currentPhase, { feature, ...result }),
  }
}

// ---------------------------------------------------------------------------
// Task Subject Detection
// ---------------------------------------------------------------------------

export function detectPdcaFromTaskSubject(
  taskSubject: string,
): { phase: string; feature: string } | null {
  if (!taskSubject) return null

  const patterns: Record<string, RegExp> = {
    research: /\[Research\]\s+(.+)/,
    plan: /\[Plan\]\s+(.+)/,
    design: /\[Design\]\s+(.+)/,
    do: /\[Do\]\s+(.+)/,
    check: /\[Check\]\s+(.+)/,
    act: /\[Act(?:-\d+)?\]\s+(.+)/,
    report: /\[Report\]\s+(.+)/,
  }

  for (const [phase, pattern] of Object.entries(patterns)) {
    const match = taskSubject.match(pattern)
    if (match) {
      return { phase, feature: match[1]?.trim() }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Next Action After Completion
// ---------------------------------------------------------------------------

export async function getNextPdcaActionAfterCompletion(
  phase: string,
  feature: string,
  projectDir: string,
): Promise<{ nextPhase: string; command: string; autoExecute: boolean } | null> {
  if (!phase || !feature) return null

  const status = await getPdcaStatus(projectDir)
  const featureData = status?.features?.[feature]
  const matchRate = featureData?.matchRate

  const nextPhaseMap: Record<string, { nextPhase: string; command: string }> = {
    research: { nextPhase: "plan", command: `/pdca plan ${feature}` },
    plan: { nextPhase: "design", command: `/pdca design ${feature}` },
    design: { nextPhase: "do", command: `/pdca do ${feature}` },
    do: { nextPhase: "check", command: `/pdca analyze ${feature}` },
    check:
      (matchRate ?? 0) >= 90
        ? { nextPhase: "report", command: `/pdca report ${feature}` }
        : { nextPhase: "act", command: `/pdca iterate ${feature}` },
    act: { nextPhase: "check", command: `/pdca analyze ${feature}` },
    report: { nextPhase: "completed", command: `/pdca archive ${feature}` },
  }

  const next = nextPhaseMap[phase]
  if (!next) return null

  return {
    ...next,
    autoExecute: shouldAutoAdvance(phase, projectDir),
  }
}
