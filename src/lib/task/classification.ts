// Task Classification Module
// Classifies tasks by size and maps to appropriate PDCA levels.
// Ported from bkit-claude-code lib/task/classification.js to TypeScript for OpenCode.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskClassification = "trivial" | "minor" | "feature" | "major"
export type PdcaLevel = "none" | "light" | "standard" | "full"

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export const CLASSIFICATION_THRESHOLDS = {
  trivial: { maxChars: 200, maxLines: 10 },
  minor: { maxChars: 1000, maxLines: 50 },
  feature: { maxChars: 5000, maxLines: 200 },
  major: { maxChars: Infinity, maxLines: Infinity },
} as const

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function classifyTask(content: string): TaskClassification {
  if (!content) return "trivial"

  const charCount = content.length

  if (charCount <= CLASSIFICATION_THRESHOLDS.trivial.maxChars) return "trivial"
  if (charCount <= CLASSIFICATION_THRESHOLDS.minor.maxChars) return "minor"
  if (charCount <= CLASSIFICATION_THRESHOLDS.feature.maxChars) return "feature"
  return "major"
}

export function classifyTaskByLines(content: string): TaskClassification {
  if (!content) return "trivial"

  const lineCount = content.split("\n").length

  if (lineCount <= CLASSIFICATION_THRESHOLDS.trivial.maxLines) return "trivial"
  if (lineCount <= CLASSIFICATION_THRESHOLDS.minor.maxLines) return "minor"
  if (lineCount <= CLASSIFICATION_THRESHOLDS.feature.maxLines) return "feature"
  return "major"
}

// ---------------------------------------------------------------------------
// PDCA Level Mapping
// ---------------------------------------------------------------------------

export function getPdcaLevel(classification: TaskClassification): PdcaLevel {
  const levels: Record<TaskClassification, PdcaLevel> = {
    trivial: "none",
    minor: "light",
    feature: "standard",
    major: "full",
  }
  return levels[classification] ?? "light"
}

export function getPdcaGuidance(classification: TaskClassification): string {
  const guidance: Record<TaskClassification, string> = {
    trivial: "Trivial change. No PDCA needed.",
    minor: "Minor change. Consider brief documentation.",
    feature: "Feature-level change. Design doc recommended.",
    major: "Major change. Full PDCA cycle strongly recommended.",
  }
  return guidance[classification] ?? ""
}

export function getPdcaGuidanceByLevel(
  level: PdcaLevel,
  feature: string,
  lineCount: number,
): string {
  const guidance: Record<PdcaLevel, string> = {
    none: `Minor change (${lineCount} lines). PDCA optional.`,
    light: `Moderate change (${lineCount} lines). Design doc recommended for '${feature}'.`,
    standard: `Feature (${lineCount} lines). Design doc recommended for '${feature}'. Consider /pdca design ${feature}`,
    full: `Major feature (${lineCount} lines) without design doc. Strongly recommend /pdca design ${feature} first.`,
  }
  return guidance[level] ?? ""
}
