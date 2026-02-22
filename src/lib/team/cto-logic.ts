// CTO Decision Logic Module
// CTO agent decision-making for PDCA phase management, document evaluation,
// and team composition recommendations.
// Ported from bkit-claude-code lib/team/cto-logic.js to TypeScript for OpenCode.

import { debugLog } from "../core/debug"
import {
  ROLE_CATALOG,
  LEVEL_CONFIG,
  selectRolesForFeature,
  TEAM_STRATEGIES,
  type TeamStrategy,
} from "./strategy"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhaseDecision {
  currentPhase: string | null
  nextPhase: string | null
  readyToAdvance: boolean
  blockers: string[]
}

export interface DocumentEvaluation {
  exists: boolean
  path: string | null
  hasRequiredSections: boolean
  score: number
  issues: string[]
}

export interface CheckEvaluation {
  decision: "report" | "iterate" | "redesign"
  reason: string
  nextAction: string
}

export interface TeamRecommendation {
  level: string
  pattern: string
  teammates: { name: string; agents: string[]; description: string }[]
  reasoning: string
  isRecommendation: boolean
}

// ---------------------------------------------------------------------------
// Phase Decision
// ---------------------------------------------------------------------------

export function decidePdcaPhase(
  featureData: { phase?: string; matchRate?: number; criticalIssues?: number } | null,
): PhaseDecision {
  const blockers: string[] = []
  const currentPhase = featureData?.phase || null

  if (!currentPhase) {
    return {
      currentPhase: null,
      nextPhase: "plan",
      readyToAdvance: true,
      blockers: [],
    }
  }

  const phaseOrder = ["research", "plan", "design", "do", "check", "act", "report"]
  const currentIdx = phaseOrder.indexOf(currentPhase)
  let nextPhase: string | null = null

  if (currentPhase === "check") {
    const matchRate = featureData?.matchRate
    if (matchRate == null) {
      blockers.push("Match rate not available")
    } else if (matchRate < 90) {
      blockers.push(`Match rate ${matchRate}% is below 90% threshold`)
    }

    const criticalIssues = featureData?.criticalIssues ?? 0
    if (criticalIssues > 0) {
      blockers.push(`${criticalIssues} critical issues remain`)
    }

    nextPhase = blockers.length === 0 ? "report" : "act"
  } else if (currentIdx >= 0 && currentIdx < phaseOrder.length - 1) {
    nextPhase = phaseOrder[currentIdx + 1]
  }

  debugLog("CTOLogic", "Phase decision", {
    currentPhase,
    nextPhase,
    blockers,
  })

  return {
    currentPhase,
    nextPhase,
    readyToAdvance: blockers.length === 0,
    blockers,
  }
}

// ---------------------------------------------------------------------------
// Document Evaluation
// ---------------------------------------------------------------------------

export function evaluateDocument(
  content: string | null,
  docType: "plan" | "design",
  feature: string,
): DocumentEvaluation {
  if (!content) {
    return {
      exists: false,
      path: null,
      hasRequiredSections: false,
      score: 0,
      issues: [`${docType} document not found for feature: ${feature}`],
    }
  }

  const requiredSections =
    docType === "plan"
      ? ["Overview", "Scope", "Goals"]
      : ["Overview", "Architecture", "Data Model", "API", "Implementation"]

  const issues: string[] = []
  let foundSections = 0

  for (const section of requiredSections) {
    if (content.toLowerCase().includes(section.toLowerCase())) {
      foundSections++
    } else {
      issues.push(`Missing section: ${section}`)
    }
  }

  const score = Math.round((foundSections / requiredSections.length) * 100)

  debugLog("CTOLogic", "Document evaluation", { feature, docType, score, issues })

  return {
    exists: true,
    path: null,
    hasRequiredSections: issues.length === 0,
    score,
    issues,
  }
}

// ---------------------------------------------------------------------------
// Check Results Evaluation
// ---------------------------------------------------------------------------

export function evaluateCheckResults(
  matchRate: number,
  criticalIssues: number,
  qualityScore: number,
): CheckEvaluation {
  let decision: CheckEvaluation["decision"]
  let reason: string
  let nextAction: string

  if (matchRate >= 90 && criticalIssues === 0) {
    decision = "report"
    reason = `Match rate ${matchRate}% meets threshold, no critical issues`
    nextAction = "/pdca report"
  } else if (matchRate >= 70) {
    decision = "iterate"
    reason =
      criticalIssues > 0
        ? `${criticalIssues} critical issues need resolution`
        : `Match rate ${matchRate}% below 90% threshold`
    nextAction = "/pdca iterate"
  } else {
    decision = "redesign"
    reason = `Match rate ${matchRate}% is critically low, redesign recommended`
    nextAction = "/pdca design"
  }

  debugLog("CTOLogic", "Check results evaluation", {
    matchRate,
    criticalIssues,
    qualityScore,
    decision,
  })

  return { decision, reason, nextAction }
}

// ---------------------------------------------------------------------------
// Agent Selection
// ---------------------------------------------------------------------------

export function selectAgentsForRole(
  role: string,
  phase: string,
  _level: string,
): string[] {
  const roleConfig = ROLE_CATALOG.find((r) => r.name === role)
  if (!roleConfig) return []

  if (!roleConfig.phases.includes(phase)) return []

  return roleConfig.agents || []
}

// ---------------------------------------------------------------------------
// Team Composition Recommendation
// ---------------------------------------------------------------------------

export function recommendTeamComposition(
  feature: string,
  phase: string,
  level: string = "Dynamic",
): TeamRecommendation {
  const config = LEVEL_CONFIG[level]

  if (!config) {
    return {
      level,
      pattern: "single",
      teammates: [],
      reasoning: `${level} level does not support team mode`,
      isRecommendation: false,
    }
  }

  const pattern = config.phaseStrategy[phase] || "single"
  const selected = selectRolesForFeature(feature, phase, level)

  const teammates = selected.map((s) => ({
    name: s.role.name,
    agents: s.role.agents,
    description: s.role.description,
  }))

  // Build reasoning with keyword match details
  const reasonParts: string[] = []
  for (const s of selected) {
    if (s.matchReason === "keyword") {
      reasonParts.push(`${s.role.name} (matched: ${s.matchedKeywords.join(", ")})`)
    } else if (s.matchReason === "alwaysInPhase") {
      reasonParts.push(`${s.role.name} (auto-included in ${phase})`)
    } else {
      reasonParts.push(`${s.role.name} (phase fallback)`)
    }
  }

  const reasoning =
    teammates.length > 0
      ? `${level} ${phase} phase, ${pattern} pattern: ${reasonParts.join("; ")}`
      : `No team roles matched for ${phase} phase at ${level} level`

  debugLog("CTOLogic", "Team recommendation", {
    feature,
    phase,
    level,
    pattern,
    teammateCount: teammates.length,
    matchDetails: selected.map((s) => ({ name: s.role.name, reason: s.matchReason })),
  })

  return { level, pattern, teammates, reasoning, isRecommendation: true }
}
