/**
 * Project Level Detection
 *
 * Determines the project complexity level (Starter, Dynamic, Enterprise) by
 * inspecting the directory structure and package.json dependencies.
 */

import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import type { PdcaPhase } from "./phase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectLevel = "Starter" | "Dynamic" | "Enterprise";

export interface PhaseConfig {
  required: PdcaPhase[]
  optional: PdcaPhase[]
  skippable: PdcaPhase[]
}

// ---------------------------------------------------------------------------
// Level-Phase Map (type-safe, OpenCode advantage over JS versions)
// ---------------------------------------------------------------------------

export const LEVEL_PHASE_MAP: Record<ProjectLevel, PhaseConfig> = {
  Starter: {
    required: ["plan", "do"],
    optional: ["research", "design"],
    skippable: ["check", "act"],
  },
  Dynamic: {
    required: ["research", "plan", "design", "do", "check"],
    optional: ["act"],
    skippable: [],
  },
  Enterprise: {
    required: ["research", "plan", "design", "do", "check", "act"],
    optional: [],
    skippable: [],
  },
};

// ---------------------------------------------------------------------------
// Detection markers (aligned with bkit.config.json levelDetection)
// ---------------------------------------------------------------------------

/** Directories whose presence indicates an Enterprise-level project */
const ENTERPRISE_DIRECTORIES = [
  "kubernetes",
  "terraform",
  "k8s",
  "infrastructure",
  "helm",
];

/** Files whose presence indicates an Enterprise-level project */
const ENTERPRISE_FILES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "terraform.tf",
];

/** Directories whose presence indicates a Dynamic-level project */
const DYNAMIC_DIRECTORIES = ["lib/bkend", "supabase", "api", "server"];

/**
 * Patterns found in package.json dependencies that indicate a Dynamic-level
 * project (backend / data layer tooling).
 */
const DYNAMIC_PACKAGE_PATTERNS = [
  "@bkend",
  "supabase",
  "prisma",
  "drizzle",
  "@prisma/client",
  "drizzle-orm",
  "@supabase/supabase-js",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_MAP: Record<string, ProjectLevel> = {
  starter: "Starter",
  dynamic: "Dynamic",
  enterprise: "Enterprise",
};

/**
 * Normalize a level string to canonical form (case-insensitive).
 * "enterprise" → "Enterprise", "DYNAMIC" → "Dynamic", etc.
 */
export function normalizeLevel(raw: unknown): ProjectLevel | null {
  if (typeof raw !== "string") return null;
  return LEVEL_MAP[raw.toLowerCase()] ?? null;
}

function dirExists(base: string, relative: string): boolean {
  try {
    return existsSync(join(base, relative));
  } catch {
    return false;
  }
}

function fileExistsSync(base: string, relative: string): boolean {
  try {
    return existsSync(join(base, relative));
  } catch {
    return false;
  }
}

/**
 * Reads `package.json` from the project root and returns the merged set of
 * `dependencies` and `devDependencies` package names.
 */
function getPackageNames(directory: string): Set<string> {
  const pkgPath = join(directory, "package.json");
  try {
    if (!existsSync(pkgPath)) return new Set();

    const raw = readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const names = new Set<string>();

    if (pkg.dependencies) {
      for (const name of Object.keys(pkg.dependencies)) {
        names.add(name);
      }
    }
    if (pkg.devDependencies) {
      for (const name of Object.keys(pkg.devDependencies)) {
        names.add(name);
      }
    }

    return names;
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the user-selected project level from .bkit-memory.json.
 * Returns null if not stored.
 */
export function getStoredLevel(directory: string): ProjectLevel | null {
  try {
    const memoryPath = join(directory, "docs", ".bkit-memory.json");
    if (!existsSync(memoryPath)) return null;
    const data = JSON.parse(readFileSync(memoryPath, "utf-8"));
    const raw = data?.projectLevel;
    const level = normalizeLevel(raw);
    if (level) return level;
  } catch (e: any) {
    try { process.stderr.write(`[bkit] getStoredLevel error: ${e?.message}\n`); } catch {}
  }
  return null;
}

/**
 * Detect the project level.
 *
 * Priority order:
 *  1. User-selected level stored in .bkit-memory.json (always wins)
 *  2. null — level not yet determined (caller must ask user)
 *
 * Auto-detection from directory/package.json is NO LONGER used as default.
 * The user must explicitly choose their project level.
 */
export function detectLevel(directory: string): ProjectLevel | null {
  // 1. Check stored user selection first
  const stored = getStoredLevel(directory);
  if (stored) return stored;

  // 2. No stored level — return null (caller must ask user)
  return null;
}

/**
 * Auto-detect level from directory structure (used as suggestion only).
 * Does NOT read stored level. Returns best guess for display to user.
 */
export function autoDetectLevel(directory: string): ProjectLevel {
  // --- Enterprise check ---
  for (const dir of ENTERPRISE_DIRECTORIES) {
    if (dirExists(directory, dir)) return "Enterprise";
  }
  for (const file of ENTERPRISE_FILES) {
    if (fileExistsSync(directory, file)) return "Enterprise";
  }

  // --- Dynamic check ---
  for (const dir of DYNAMIC_DIRECTORIES) {
    if (dirExists(directory, dir)) return "Dynamic";
  }
  const packageNames = getPackageNames(directory);
  for (const pattern of DYNAMIC_PACKAGE_PATTERNS) {
    for (const pkgName of packageNames) {
      if (pkgName === pattern || pkgName.startsWith(pattern + "/") || pkgName.startsWith(pattern)) {
        return "Dynamic";
      }
    }
  }

  return "Starter";
}

/**
 * Store the user-selected project level in .bkit-memory.json.
 */
export function storeLevel(directory: string, level: ProjectLevel): void {
  const memoryPath = join(directory, "docs", ".bkit-memory.json");
  try {
    let data: Record<string, any> = {};
    if (existsSync(memoryPath)) {
      data = JSON.parse(readFileSync(memoryPath, "utf-8"));
    } else {
      const dir = join(directory, "docs");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    data.projectLevel = level;
    writeFileSync(memoryPath, JSON.stringify(data, null, 2) + "\n");
  } catch (e: any) {
    // Log error instead of silently swallowing
    try { process.stderr.write(`[bkit] storeLevel error: ${e?.message}\n`); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Phase-Level Functions
// ---------------------------------------------------------------------------

/** Check if a phase can be skipped for the given project level */
export function canSkipPhase(level: ProjectLevel, phase: PdcaPhase): boolean {
  return LEVEL_PHASE_MAP[level].skippable.includes(phase)
}

/** Get the list of required PDCA phases for a project level */
export function getRequiredPhases(level: ProjectLevel): PdcaPhase[] {
  return LEVEL_PHASE_MAP[level].required
}

/** Get the next applicable phase for a level, skipping phases that don't apply */
export function getNextPhaseForLevel(level: ProjectLevel, currentPhase: PdcaPhase): PdcaPhase | null {
  const order: PdcaPhase[] = ["research", "plan", "design", "do", "check", "act"]
  const currentIndex = order.indexOf(currentPhase)
  if (currentIndex < 0) return null

  const config = LEVEL_PHASE_MAP[level]
  const applicable = new Set([...config.required, ...config.optional])

  for (let i = currentIndex + 1; i < order.length; i++) {
    if (applicable.has(order[i])) return order[i]
  }
  return null
}

/** Check if a phase is applicable (required or optional) for the given level */
export function isPhaseApplicable(level: ProjectLevel, phase: PdcaPhase): boolean {
  const config = LEVEL_PHASE_MAP[level]
  return config.required.includes(phase) || config.optional.includes(phase)
}

/** Get human-readable phase guide for a project level */
export function getLevelPhaseGuide(level: ProjectLevel): string {
  const config = LEVEL_PHASE_MAP[level]
  const lines: string[] = [`PDCA Phases for ${level} Level:`]

  if (config.required.length > 0) {
    lines.push(`  Required: ${config.required.join(" → ")}`)
  }
  if (config.optional.length > 0) {
    lines.push(`  Optional: ${config.optional.join(", ")}`)
  }
  if (config.skippable.length > 0) {
    lines.push(`  Skippable: ${config.skippable.join(", ")}`)
  }

  return lines.join("\n")
}
