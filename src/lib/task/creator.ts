// Task Creation Module
// Generates PDCA task objects with proper subjects, descriptions, and metadata.
// Ported from bkit-claude-code lib/task/creator.js to TypeScript for OpenCode.

import { debugLog } from "../core/debug"
import { getPhaseNumber } from "../pdca/phase"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdcaTaskMetadata {
  pdcaPhase: string
  pdcaOrder: number
  feature: string
  level: string
  createdAt: string
}

export interface PdcaTask {
  id: string
  subject: string
  description: string
  metadata: PdcaTaskMetadata
  status?: string
  blockedBy?: string[]
}

// ---------------------------------------------------------------------------
// Subject & Description Generators
// ---------------------------------------------------------------------------

const PHASE_ICONS: Record<string, string> = {
  research: "🔬",
  plan: "📋",
  design: "📐",
  do: "🔨",
  check: "🔍",
  act: "🔄",
  report: "📊",
}

export function generatePdcaTaskSubject(phase: string, feature: string): string {
  const icon = PHASE_ICONS[phase] || "📌"
  return `${icon} [${phase.charAt(0).toUpperCase() + phase.slice(1)}] ${feature}`
}

export function generatePdcaTaskDescription(
  phase: string,
  feature: string,
  docPath: string = "",
): string {
  const descriptions: Record<string, string> = {
    plan: `Plan phase for ${feature}. Define requirements and scope.`,
    design: `Design phase for ${feature}. Create detailed design document.`,
    do: `Implementation phase for ${feature}. Build according to design.`,
    check: `Verification phase for ${feature}. Run gap analysis.`,
    act: `Improvement phase for ${feature}. Fix gaps found in check.`,
    report: `Reporting phase for ${feature}. Generate completion report.`,
  }

  let desc = descriptions[phase] || `${phase} phase for ${feature}`
  if (docPath) desc += `\n\nReference: ${docPath}`

  return desc
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export function getPdcaTaskMetadata(
  phase: string,
  feature: string,
  options: { level?: string } = {},
): PdcaTaskMetadata {
  return {
    pdcaPhase: phase,
    pdcaOrder: getPhaseNumber(phase),
    feature,
    level: options.level || "Dynamic",
    createdAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Task Guidance
// ---------------------------------------------------------------------------

export function generateTaskGuidance(
  phase: string,
  feature: string,
  blockedByPhase: string = "",
): string {
  let guidance = `Phase: ${phase}\nFeature: ${feature}\n\n`

  if (blockedByPhase) {
    guidance += `⚠️ Blocked by: ${blockedByPhase} phase\n`
    guidance += `Complete the ${blockedByPhase} phase first.\n\n`
  }

  const phaseGuidance: Record<string, string> = {
    plan: "Create a plan document with requirements and scope.",
    design: "Create a design document with architecture and implementation details.",
    do: "Implement according to the design document.",
    check: "Run /pdca analyze to verify implementation matches design.",
    act: "Run /pdca iterate to fix any gaps found.",
    report: "Run /pdca report to generate completion report.",
  }

  guidance += phaseGuidance[phase] || ""

  return guidance
}

// ---------------------------------------------------------------------------
// Task Chain
// ---------------------------------------------------------------------------

export function createPdcaTaskChain(
  feature: string,
  options: { level?: string } = {},
): { feature: string; tasks: Record<string, PdcaTask>; phases: string[]; createdAt: string } {
  const phases = ["research", "plan", "design", "do", "check", "report"]
  const tasks: Record<string, PdcaTask> = {}

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]
    const blockedBy = i > 0 ? phases[i - 1] : null
    const taskId = `${phase}-${feature}-${Date.now()}`

    tasks[phase] = {
      id: taskId,
      subject: generatePdcaTaskSubject(phase, feature),
      description: generatePdcaTaskDescription(phase, feature),
      metadata: getPdcaTaskMetadata(phase, feature, options),
      blockedBy: blockedBy && tasks[blockedBy] ? [tasks[blockedBy].id] : [],
    }
  }

  debugLog("task", "Created PDCA task chain", { feature, taskCount: phases.length })

  return {
    feature,
    tasks,
    phases,
    createdAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Auto-Create Single Task
// ---------------------------------------------------------------------------

export function autoCreatePdcaTask(
  feature: string,
  phase: string,
  options: { level?: string; docPath?: string } = {},
): PdcaTask {
  const taskId = `${phase}-${feature}-${Date.now()}`

  const task: PdcaTask = {
    id: taskId,
    subject: generatePdcaTaskSubject(phase, feature),
    description: generatePdcaTaskDescription(phase, feature, options.docPath),
    metadata: getPdcaTaskMetadata(phase, feature, options),
    status: "pending",
  }

  debugLog("task", "Auto-created PDCA task", { taskId, phase, feature })

  return task
}
