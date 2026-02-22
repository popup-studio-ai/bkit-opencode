/**
 * PDCA Phase Constants and Next-Phase Guidance
 *
 * Provides the ordered list of PDCA phases and generates contextual guidance
 * for transitioning to the next phase based on the current status.
 */

import { join } from "path";
import { existsSync } from "fs";
import type { PdcaStatus, PdcaFeature } from "./status";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PDCA_PHASES = ["research", "plan", "design", "do", "check", "act"] as const;
export type PdcaPhase = (typeof PDCA_PHASES)[number];

/** Match rate threshold above which the Check phase is considered passing */
const MATCH_RATE_THRESHOLD = 90;

/** Maximum number of Act iterations before forcing completion */
const MAX_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Phase metadata
// ---------------------------------------------------------------------------

interface PhaseInfo {
  label: string;
  description: string;
  command: string;
  prerequisite?: string;
}

const PHASE_INFO: Record<PdcaPhase | "completed" | "archived", PhaseInfo> = {
  research: {
    label: "Research",
    description: "Research the problem domain, existing solutions, and technology options before planning.",
    command: "/pdca plan {feature}",
  },
  plan: {
    label: "Plan",
    description: "Define goals, scope, and success criteria for the feature.",
    command: "/pdca plan {feature}",
    prerequisite: "Research should be completed first (docs/00-research/).",
  },
  design: {
    label: "Design",
    description:
      "Create technical design document based on the plan: architecture, data models, API specs, and user journey flows.",
    command: "/pdca design {feature}",
    prerequisite: "Plan document must exist.",
  },
  do: {
    label: "Do",
    description:
      "Implement the feature following the design document. Code, tests, and integration.",
    command: "/pdca do {feature}",
    prerequisite: "Design document must exist.",
  },
  check: {
    label: "Check",
    description:
      "Run gap analysis comparing design to implementation. Calculate match rate.",
    command: "/pdca analyze {feature}",
    prerequisite: "Implementation code must exist.",
  },
  act: {
    label: "Act",
    description:
      "Iterate on gaps found during Check. Auto-fix code and re-verify until threshold met.",
    command: "/pdca iterate {feature}",
    prerequisite: "Gap analysis must show match rate below threshold.",
  },
  completed: {
    label: "Completed",
    description:
      "Feature has passed all quality gates. Generate final report and optionally archive.",
    command: "/pdca report {feature}",
  },
  archived: {
    label: "Archived",
    description: "Feature documents have been archived.",
    command: "/pdca status",
  },
};

// ---------------------------------------------------------------------------
// Phase Number
// ---------------------------------------------------------------------------

const PHASE_ORDER: Record<string, number> = {
  research: 0,
  plan: 1,
  design: 2,
  do: 3,
  check: 4,
  act: 5,
  report: 6,
  completed: 7,
  archived: 8,
}

/** Get numeric order for a PDCA phase. Returns 0 for unknown phases. */
export function getPhaseNumber(phase: string): number {
  return PHASE_ORDER[phase] ?? 0
}

/** Get phase name from number. Returns "unknown" for unrecognised numbers. */
export function getPhaseName(phaseNumber: number): string {
  for (const [name, num] of Object.entries(PHASE_ORDER)) {
    if (num === phaseNumber) return name
  }
  return "unknown"
}

/** Get the previous PDCA phase. Returns null if already at the first phase. */
export function getPreviousPdcaPhase(currentPhase: string): string | null {
  const order = ["research", "plan", "design", "do", "check", "act", "report"]
  const index = order.indexOf(currentPhase)
  return index > 0 ? order[index - 1] : null
}

/** Get the next PDCA phase. Returns null if already at the last phase. */
export function getNextPdcaPhase(currentPhase: string): string | null {
  const order = ["research", "plan", "design", "do", "check", "act", "report"]
  const index = order.indexOf(currentPhase)
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null
}

/**
 * Find the design document for a feature.
 * Checks multiple conventional locations and returns the path or empty string.
 */
export function findDesignDoc(feature: string, projectDir: string): string {
  if (!feature) return ""
  const paths = [
    join(projectDir, "docs", "02-design", "features", `${feature}.design.md`),
    join(projectDir, "docs", "02-design", `${feature}.design.md`),
    join(projectDir, "docs", "design", `${feature}.md`),
  ]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return ""
}

/**
 * Find the plan document for a feature.
 * Checks multiple conventional locations and returns the path or empty string.
 */
export function findPlanDoc(feature: string, projectDir: string): string {
  if (!feature) return ""
  const paths = [
    join(projectDir, "docs", "01-plan", "features", `${feature}.plan.md`),
    join(projectDir, "docs", "01-plan", `${feature}.plan.md`),
    join(projectDir, "docs", "plan", `${feature}.md`),
  ]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return ""
}

/**
 * Check that phase deliverables exist.
 * Returns an object indicating whether the deliverable was found and its path.
 */
export function checkPhaseDeliverables(
  phase: string,
  feature: string,
  projectDir: string
): { exists: boolean; path: string | null } {
  if (!feature) return { exists: false, path: null }

  const deliverablePaths: Record<string, string[]> = {
    plan: [
      `docs/01-plan/features/${feature}.plan.md`,
      `docs/01-plan/${feature}.plan.md`,
    ],
    design: [
      `docs/02-design/features/${feature}.design.md`,
      `docs/02-design/${feature}.design.md`,
    ],
    check: [
      `docs/03-analysis/${feature}.analysis.md`,
      `docs/03-analysis/features/${feature}.analysis.md`,
    ],
    report: [
      `docs/04-report/features/${feature}.report.md`,
      `docs/04-report/${feature}.report.md`,
    ],
  }

  const candidates = deliverablePaths[phase]
  if (!candidates) return { exists: true, path: null } // No deliverable required

  for (const relPath of candidates) {
    const fullPath = join(projectDir, relPath)
    if (existsSync(fullPath)) {
      return { exists: true, path: fullPath }
    }
  }

  return { exists: false, path: null }
}

/**
 * Validate whether a phase transition is allowed.
 * Prevents skipping phases and checks deliverables.
 */
export function validatePdcaTransition(
  feature: string,
  fromPhase: string,
  toPhase: string,
  projectDir: string
): { valid: boolean; reason: string } {
  const fromOrder = getPhaseNumber(fromPhase)
  const toOrder = getPhaseNumber(toPhase)

  // Allow going back
  if (toOrder < fromOrder) {
    return { valid: true, reason: "Returning to earlier phase" }
  }

  // Prevent skipping phases
  if (toOrder > fromOrder + 1) {
    return { valid: false, reason: `Cannot skip from ${fromPhase} to ${toPhase}` }
  }

  // Check deliverables for current phase
  const deliverable = checkPhaseDeliverables(fromPhase, feature, projectDir)
  if (!deliverable.exists && fromPhase !== "do" && fromPhase !== "act") {
    return { valid: false, reason: `${fromPhase} deliverable not found` }
  }

  return { valid: true, reason: "Transition allowed" }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns human-readable guidance for what the user should do next, based on
 * the current PDCA status of a feature.
 *
 * If `feature` is omitted the `primaryFeature` from the status is used.
 */
export function getNextPhaseGuidance(
  status: PdcaStatus,
  feature?: string
): string {
  const featureName = feature ?? status.primaryFeature;

  // No feature at all yet
  if (!featureName) {
    const info = PHASE_INFO.plan;
    return [
      "No active feature found.",
      "",
      `Next step: ${info.label} Phase`,
      info.description,
      "",
      "Start a new feature with:",
      `  ${info.command}`,
    ].join("\n");
  }

  const feat = status.features[featureName];

  // Feature name given but not tracked yet
  if (!feat) {
    const info = PHASE_INFO.plan;
    return [
      `Feature "${featureName}" is not tracked yet.`,
      "",
      `Next step: ${info.label} Phase`,
      info.description,
      "",
      `Command: ${info.command.replace("{feature}", featureName)}`,
    ].join("\n");
  }

  return buildGuidanceForFeature(featureName, feat);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function buildGuidanceForFeature(
  featureName: string,
  feat: PdcaFeature
): string {
  const lines: string[] = [];
  const replace = (cmd: string) => cmd.replace("{feature}", featureName);

  switch (feat.phase) {
    case "plan": {
      const next = PHASE_INFO.design;
      lines.push(
        `Feature "${featureName}" is in the Plan phase.`,
        "",
        `Next step: ${next.label} Phase`,
        next.description,
        ""
      );
      if (next.prerequisite) {
        lines.push(`Prerequisite: ${next.prerequisite}`);
      }
      lines.push(`Command: ${replace(next.command)}`);
      break;
    }

    case "design": {
      const next = PHASE_INFO.do;
      lines.push(
        `Feature "${featureName}" is in the Design phase.`,
        "",
        `Next step: ${next.label} Phase`,
        next.description,
        ""
      );
      if (next.prerequisite) {
        lines.push(`Prerequisite: ${next.prerequisite}`);
      }
      lines.push(`Command: ${replace(next.command)}`);
      break;
    }

    case "do": {
      const next = PHASE_INFO.check;
      lines.push(
        `Feature "${featureName}" is in the Do phase.`,
        "",
        `Next step: ${next.label} Phase`,
        next.description,
        ""
      );
      if (next.prerequisite) {
        lines.push(`Prerequisite: ${next.prerequisite}`);
      }
      lines.push(`Command: ${replace(next.command)}`);
      break;
    }

    case "check": {
      const matchRate = feat.matchRate ?? 0;
      if (matchRate >= MATCH_RATE_THRESHOLD) {
        // Passed -- go to report
        const next = PHASE_INFO.completed;
        lines.push(
          `Feature "${featureName}" passed Check with ${matchRate}% match rate.`,
          "",
          `Next step: ${next.label}`,
          next.description,
          "",
          `Command: ${replace(next.command)}`
        );
      } else {
        // Below threshold -- iterate
        const next = PHASE_INFO.act;
        const iterations = feat.iterations ?? 0;
        lines.push(
          `Feature "${featureName}" is at ${matchRate}% match rate (threshold: ${MATCH_RATE_THRESHOLD}%).`,
          ""
        );
        if (iterations >= MAX_ITERATIONS) {
          lines.push(
            `WARNING: Max iterations (${MAX_ITERATIONS}) reached. Consider reviewing manually or generating a report.`,
            "",
            `Commands:`,
            `  ${replace(PHASE_INFO.completed.command)}  (generate report)`,
            `  ${replace(next.command)}  (force another iteration)`
          );
        } else {
          lines.push(
            `Next step: ${next.label} Phase (iteration ${iterations + 1}/${MAX_ITERATIONS})`,
            next.description,
            "",
            `Command: ${replace(next.command)}`
          );
        }
      }
      break;
    }

    case "act": {
      // After Act, re-run Check
      const next = PHASE_INFO.check;
      const iterations = feat.iterations ?? 0;
      lines.push(
        `Feature "${featureName}" completed Act iteration ${iterations}.`,
        "",
        `Next step: Re-run ${next.label} Phase`,
        "Verify whether the iteration resolved the gaps.",
        "",
        `Command: ${replace(next.command)}`
      );
      break;
    }

    case "completed": {
      lines.push(
        `Feature "${featureName}" is completed.`,
        "",
        "Options:",
        `  Archive:  /pdca archive ${featureName}`,
        `  View report: Read docs/04-report/features/${featureName}.report.md`
      );
      break;
    }

    case "archived": {
      lines.push(
        `Feature "${featureName}" has been archived.`,
        ""
      );
      if (feat.archivedTo) {
        lines.push(`Archive location: ${feat.archivedTo}`);
      }
      lines.push("Start a new feature with: /pdca plan [feature-name]");
      break;
    }

    default: {
      lines.push(
        `Feature "${featureName}" is in an unknown phase: ${feat.phase}`,
        "",
        "Try: /pdca status"
      );
    }
  }

  return lines.join("\n");
}
