/**
 * PDCA Status File Management
 *
 * Manages the docs/.pdca-status.json file that tracks feature progress
 * through the Research-Plan-Design-Do-Check-Act cycle.
 */

import { join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { debugLog } from "../core/debug";
import { cache } from "../core/cache";
import { getPhaseNumber } from "./phase";
import { extractFeature, isSourceFile } from "../core/file";

// ---------------------------------------------------------------------------
// File I/O helpers (Node.js fs — NOT Bun APIs, for reliability)
// ---------------------------------------------------------------------------

function readJsonFile(path: string): any | null {
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, "utf8");
    return JSON.parse(text);
  } catch (e: any) {
    debugLog("PDCA", "Failed to read JSON file", { path, error: e.message });
    return null;
  }
}

function writeJsonFile(path: string, data: any): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdcaFeature {
  phase:
    | "research"
    | "plan"
    | "design"
    | "do"
    | "check"
    | "act"
    | "completed"
    | "archived";
  /** v2 compat: numeric phase order (research=0, plan=1, design=2, do=3, check=4, act=5, ...) */
  phaseNumber?: number;
  matchRate?: number;
  /** v1 field name */
  iterations?: number;
  /** v2 field name (alias for iterations) */
  iterationCount?: number;
  startedAt: string;
  lastUpdated: string;
  /** v2 compat: nested timestamps */
  timestamps?: {
    started?: string;
    lastUpdated?: string;
  };
  documents?: {
    plan?: string;
    design?: string;
    analysis?: string;
    report?: string;
    research?: string;
  };
  /** doc-evaluator scores per phase */
  evalScores?: {
    plan?: number;
    design?: number;
  };
  /** Set when the feature has been archived */
  archivedAt?: string;
  /** Path to the archive directory */
  archivedTo?: string;
}

/** Session metadata tracked in .pdca-status.json */
export interface PdcaSession {
  startedAt?: string;
  onboardingCompleted?: boolean;
  lastActivity?: string;
}

/** Pipeline metadata tracked in .pdca-status.json */
export interface PdcaPipeline {
  currentPhase?: number;
  level?: string;
  phaseHistory?: unknown[];
}

/** A single history entry for PDCA phase transitions */
export interface PdcaHistoryEntry {
  timestamp: string;
  feature?: string;
  phase?: string;
  action?: string;
  [key: string]: unknown;
}

export interface PdcaStatus {
  version: string;
  lastUpdated: string;
  primaryFeature?: string;
  activeFeatures: string[];
  features: Record<string, PdcaFeature>;
  /** v2 compat: session metadata */
  session?: PdcaSession;
  /** v2 compat: pipeline metadata */
  pipeline?: PdcaPipeline;
  /** v2 compat: phase transition history */
  history?: PdcaHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_FILE_PATH = "docs/.pdca-status.json";
const STATUS_VERSION = "1.0.0";
const MAX_HISTORY_ENTRIES = 100;

// FR-02.3: Write-through cache — eliminates redundant file reads after saves.
// Short TTL (5s) prevents stale data while absorbing rapid read→write→read cycles.
let _statusCache: { data: PdcaStatus; ts: number; directory: string } | null = null;
const STATUS_CACHE_TTL = 5000;

// SOURCE_EXTENSIONS removed — use isSourceFile() from "../core/file" instead.

/** L-2: Shared history trim — keeps only the last MAX_HISTORY_ENTRIES. */
function trimHistory(status: PdcaStatus): void {
  if (status.history && status.history.length > MAX_HISTORY_ENTRIES) {
    status.history.splice(0, status.history.length - MAX_HISTORY_ENTRIES);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultStatus(): PdcaStatus {
  return {
    version: STATUS_VERSION,
    lastUpdated: new Date().toISOString(),
    primaryFeature: undefined,
    activeFeatures: [],
    features: {},
    session: undefined,
    pipeline: undefined,
    history: [],
  };
}

function statusFilePath(directory: string): string {
  return join(directory, STATUS_FILE_PATH);
}

// fileExists removed — use existsSync() directly for reliability

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalise a single feature entry — supports both v1 (bkit-opencode)
 * and v2 (Claude Code bkit) formats.
 *
 * IMPORTANT: Preserves ALL fields from both formats so that read→write
 * cycles don't strip v2 fields (phaseNumber, iterationCount, timestamps).
 * Both Claude Code and OpenCode read these files, so format parity matters.
 */
function normaliseFeature(raw: any): PdcaFeature {
  if (!raw || typeof raw !== "object") {
    return {
      phase: "plan",
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  }

  // Map v2 timestamps to v1 fields (but also preserve timestamps object)
  const timestamps = raw.timestamps as
    | { started?: string; lastUpdated?: string }
    | undefined;

  const iterationValue = raw.iterations ?? raw.iterationCount ?? undefined;

  return {
    phase: raw.phase ?? "plan",
    phaseNumber: raw.phaseNumber ?? undefined,
    matchRate: raw.matchRate ?? undefined,
    iterations: iterationValue,
    iterationCount: iterationValue, // v2 compat: keep both field names in sync
    startedAt:
      raw.startedAt ?? timestamps?.started ?? new Date().toISOString(),
    lastUpdated:
      raw.lastUpdated ?? timestamps?.lastUpdated ?? new Date().toISOString(),
    timestamps: {
      started: raw.startedAt ?? timestamps?.started ?? new Date().toISOString(),
      lastUpdated: raw.lastUpdated ?? timestamps?.lastUpdated ?? new Date().toISOString(),
    },
    documents: raw.documents ?? undefined,
    archivedAt: raw.archivedAt ?? undefined,
    archivedTo: raw.archivedTo ?? undefined,
  };
}

/**
 * Reads `docs/.pdca-status.json` from the given project directory.
 * Returns the parsed status or a default empty status if the file does not
 * exist or cannot be parsed.
 *
 * Handles both v1 (bkit-opencode) and v2 (Claude Code bkit) formats.
 */
export async function getPdcaStatus(directory: string): Promise<PdcaStatus> {
  // FR-02.3: Write-through cache check
  if (_statusCache && _statusCache.directory === directory
      && Date.now() - _statusCache.ts < STATUS_CACHE_TTL) {
    return _statusCache.data;
  }

  const path = statusFilePath(directory);

  try {
    const parsed = readJsonFile(path);
    if (!parsed) {
      return defaultStatus();
    }

    // Normalise features from any format
    const rawFeatures =
      parsed.features && typeof parsed.features === "object"
        ? parsed.features
        : {};

    const features: Record<string, PdcaFeature> = {};
    for (const [name, raw] of Object.entries(rawFeatures)) {
      features[name] = normaliseFeature(raw);
    }

    const result: PdcaStatus = {
      version: parsed.version ?? STATUS_VERSION,
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
      primaryFeature: parsed.primaryFeature ?? undefined,
      activeFeatures: Array.isArray(parsed.activeFeatures)
        ? parsed.activeFeatures
        : [],
      features,
      // v2 compat: preserve session, pipeline, history across read→write cycles
      session: parsed.session ?? undefined,
      pipeline: parsed.pipeline ?? undefined,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };

    // FR-02.3: Populate cache on read
    _statusCache = { data: result, ts: Date.now(), directory };
    return result;
  } catch (e: any) {
    debugLog("PDCA", "getPdcaStatus error", { error: e.message });
    return defaultStatus();
  }
}

/**
 * Returns true if the given directory looks like a real project root
 * (has package.json, .git, src/, etc.). Prevents creating stray
 * `.pdca-status.json` files in non-project directories like `~`.
 */
function looksLikeProject(directory: string): boolean {
  // OpenCode always sets working directory to a project root.
  // The original strict marker check caused a chicken-and-egg problem:
  // new projects had no markers yet → initPdcaStatusIfNotExists skipped
  // → .pdca-status.json never created → PDCA tracking permanently broken.
  //
  // Relaxed check: reject only obvious non-project dirs (home, root, tmp).
  const rejectPaths = [
    "/tmp", "/var", "/usr", "/etc", "/System",
    process.env.HOME, // bare home directory
  ];
  const normalized = directory.replace(/\/+$/, "");
  const rejected = rejectPaths.some((p) => p && normalized === p.replace(/\/+$/, ""));
  debugLog("PDCA", "looksLikeProject check", { directory, rejected });
  return !rejected;
}

/**
 * Creates the initial `.pdca-status.json` file if it does not already exist.
 * Also ensures the `docs/` directory exists.
 *
 * Guards against non-project directories (e.g. home dir) to prevent
 * creating stray status files.
 */
export async function initPdcaStatusIfNotExists(
  directory: string
): Promise<void> {
  const path = statusFilePath(directory);

  if (existsSync(path)) {
    debugLog("PDCA", "Status file already exists", { path });
    return; // Nothing to do
  }

  // Don't create status files in non-project directories
  if (!looksLikeProject(directory)) {
    debugLog("PDCA", "Not a project directory, skipping status init", { directory });
    // Log to stderr so users can debug when status file isn't created
    try {
      process.stderr.write(`[bkit] Skipped PDCA status init: directory "${directory}" doesn't look like a project\n`);
    } catch {}
    return;
  }

  try {
    const initial = defaultStatus();
    writeJsonFile(path, initial);
    debugLog("PDCA", "Status file created", { path });
  } catch (e: any) {
    debugLog("PDCA", "Failed to create status file", { path, error: e.message });
    try {
      process.stderr.write(`[bkit] CRITICAL: Failed to create PDCA status file: ${e?.message}\n`);
    } catch {}
  }
}

/**
 * Recovery: If PDCA docs exist but .pdca-status.json doesn't, reconstruct
 * the status from existing documents.
 *
 * Fixes the case where:
 * - initPdcaStatusIfNotExists() fails (empty project without markers)
 * - tool-after.ts's savePdcaStatus() silently fails
 * - The status file is somehow deleted
 *
 * Called on session.created AFTER initPdcaStatusIfNotExists().
 */
export async function recoverStatusFromDocs(directory: string): Promise<boolean> {
  const path = statusFilePath(directory);
  if (existsSync(path)) return false; // Status file exists, no recovery needed

  const docsDir = join(directory, "docs");
  if (!existsSync(docsDir)) return false;

  const phaseDirs: { dir: string; phase: string; docType: "plan" | "design" | "analysis" | "report" | "research" }[] = [
    { dir: "00-research", phase: "research", docType: "research" },
    { dir: "01-plan", phase: "plan", docType: "plan" },
    { dir: "02-design", phase: "design", docType: "design" },
    { dir: "03-analysis", phase: "check", docType: "analysis" },
    { dir: "04-report", phase: "completed", docType: "report" },
  ];

  const featureMap = new Map<string, { phase: string; docs: Record<string, string> }>();

  for (const { dir, phase, docType } of phaseDirs) {
    // Check both docs/{dir}/features/ and docs/{dir}/ paths
    const paths = [
      join(docsDir, dir, "features"),
      join(docsDir, dir),
      // Journey docs live under docs/02-design/journey/ (part of design phase)
      ...(dir === "02-design" ? [join(docsDir, dir, "journey")] : []),
    ];

    for (const scanPath of paths) {
      if (!existsSync(scanPath)) continue;
      try {
        const files = readdirSync(scanPath).filter(f => f.endsWith(".md"));
        for (const file of files) {
          const subDir = scanPath.includes("features") ? "features"
            : scanPath.includes("journey") ? "journey"
            : null;
          const relativePath = subDir
            ? `docs/${dir}/${subDir}/${file}`
            : `docs/${dir}/${file}`;
          const featureName = extractFeature(relativePath);
          if (!featureName) continue;

          let existing = featureMap.get(featureName);
          if (!existing) {
            existing = { phase, docs: {} };
            featureMap.set(featureName, existing);
          }
          // Latest phase wins (design > plan, check > design, etc.)
          existing.phase = phase;
          existing.docs[docType] = relativePath;
        }
      } catch {
        // Directory read failed, skip
      }
    }
  }

  if (featureMap.size === 0) return false;

  // Reconstruct status
  const status = defaultStatus();
  for (const [name, data] of featureMap) {
    applyPhaseToStatus(status, data.phase, name);
    for (const [docType, docPath] of Object.entries(data.docs)) {
      applyDocumentToStatus(status, name, docType as "plan" | "design" | "analysis" | "report" | "research", docPath);
    }
  }

  try {
    writeJsonFile(path, status);
    cache.invalidate("bkit-system-prompt");
    const recovered = Array.from(featureMap.entries()).map(([n, d]) => `${n}(${d.phase})`).join(", ");
    debugLog("PDCA", "Status recovered from existing docs", { recovered });
    try {
      process.stderr.write(`[bkit] PDCA status recovered: ${recovered}\n`);
    } catch {}
    return true;
  } catch (e: any) {
    debugLog("PDCA", "Failed to recover status from docs", { error: e.message });
    try {
      process.stderr.write(`[bkit] CRITICAL: Failed to recover PDCA status: ${e?.message}\n`);
    } catch {}
    return false;
  }
}

// ---------------------------------------------------------------------------
// "do" phase inference helpers (used by syncStatusWithDocs)
// ---------------------------------------------------------------------------

/** Source directories to scan for implementation activity. */
const SOURCE_DIRS = ["src", "lib", "app", "components", "pages", "packages"];

/** Max files to check per source directory (performance guard). */
const MAX_FS_SCAN = 50;

/**
 * Infer "do" phase by checking git for source file changes
 * since the design doc was last updated.
 * Returns false if git is unavailable or no changes found.
 */
function inferDoPhaseFromGit(directory: string, feat: PdcaFeature): boolean {
  try {
    const { spawnSync } = require("child_process");
    const sinceDate = feat.lastUpdated || feat.startedAt;

    // 1. Uncommitted source file changes (staged + unstaged)
    const diffResult = spawnSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: directory, encoding: "utf-8", timeout: 3000,
    });

    const uncommitted = (diffResult.stdout || "")
      .split("\n")
      .filter((f: string) => f.trim() && !f.startsWith("docs/") && isSourceFile(f));

    if (uncommitted.length > 0) return true;

    // 2. Committed source file changes since design was updated
    const logResult = spawnSync("git", [
      "log", `--since=${sinceDate}`,
      "--diff-filter=ACMR", "--name-only", "--pretty=format:",
    ], {
      cwd: directory, encoding: "utf-8", timeout: 3000,
    });

    const committed = (logResult.stdout || "")
      .split("\n")
      .filter((f: string) => f.trim() && !f.startsWith("docs/") && isSourceFile(f));

    return committed.length > 0;
  } catch {
    return false; // git not available
  }
}

/**
 * Fallback: infer "do" phase by comparing filesystem mtimes.
 * Checks if any source file in common directories was modified
 * after the design document.
 */
function inferDoPhaseFromFs(directory: string, feat: PdcaFeature): boolean {
  if (!feat.documents?.design) return false;

  try {
    const designPath = join(directory, feat.documents.design);
    if (!existsSync(designPath)) return false;
    const designMtime = statSync(designPath).mtimeMs;

    for (const srcDirName of SOURCE_DIRS) {
      const srcDir = join(directory, srcDirName);
      if (!existsSync(srcDir)) continue;

      try {
        const entries = readdirSync(srcDir, { recursive: true });
        let checked = 0;
        for (const entry of entries) {
          if (checked >= MAX_FS_SCAN) break;
          const fullPath = join(srcDir, String(entry));
          try {
            const st = statSync(fullPath);
            if (!st.isFile()) continue;
            if (!isSourceFile(fullPath)) continue;
            checked++;
            if (st.mtimeMs > designMtime) return true;
          } catch { /* skip unreadable file */ }
        }
      } catch { /* skip unreadable dir */ }
    }
  } catch { /* skip */ }

  return false;
}

/**
 * Sync existing PDCA docs into .pdca-status.json.
 *
 * Unlike recoverStatusFromDocs (which only works when the status file is missing),
 * this function works with an existing status and adds any features found in
 * docs/00-research, 01-plan, 02-design, 03-analysis, 04-report that are NOT yet tracked.
 *
 * Designed to be called from pdca-status tool so that documents created via bash
 * (which bypass tool-after.ts hooks) are automatically picked up.
 */
export async function syncStatusWithDocs(directory: string): Promise<boolean> {
  const docsDir = join(directory, "docs");
  if (!existsSync(docsDir)) return false;

  const status = await getPdcaStatus(directory);
  let dirty = false;

  const phaseDirs: { dir: string; phase: string; docType: "plan" | "design" | "analysis" | "report" | "research" }[] = [
    { dir: "00-research", phase: "research", docType: "research" },
    { dir: "01-plan", phase: "plan", docType: "plan" },
    { dir: "02-design", phase: "design", docType: "design" },
    { dir: "03-analysis", phase: "check", docType: "analysis" },
    { dir: "04-report", phase: "completed", docType: "report" },
  ];

  const phaseOrder = ["research", "plan", "design", "do", "check", "act", "completed"];

  for (const { dir, phase, docType } of phaseDirs) {
    const paths = [
      join(docsDir, dir, "features"),
      join(docsDir, dir),
      // Journey docs live under docs/02-design/journey/ (part of design phase)
      ...(dir === "02-design" ? [join(docsDir, dir, "journey")] : []),
    ];

    for (const scanPath of paths) {
      if (!existsSync(scanPath)) continue;
      try {
        const files = readdirSync(scanPath).filter(f => f.endsWith(".md"));
        for (const file of files) {
          const subDir = scanPath.includes("features") ? "features"
            : scanPath.includes("journey") ? "journey"
            : null;
          const relativePath = subDir
            ? `docs/${dir}/${subDir}/${file}`
            : `docs/${dir}/${file}`;
          const featureName = extractFeature(relativePath);
          if (!featureName) continue;

          const existing = status.features[featureName];
          if (!existing) {
            // Feature not tracked — register it
            applyPhaseToStatus(status, phase, featureName);
            applyDocumentToStatus(status, featureName, docType, relativePath);
            dirty = true;
            debugLog("PDCA", "syncStatusWithDocs: new feature registered", { featureName, phase });
          } else if (!existing.documents?.[docType]) {
            // Feature exists but this doc not tracked
            applyDocumentToStatus(status, featureName, docType, relativePath);
            // Advance phase if doc implies a later phase
            const currentIdx = phaseOrder.indexOf(existing.phase);
            const docIdx = phaseOrder.indexOf(phase);
            if (docIdx > currentIdx) {
              applyPhaseToStatus(status, phase, featureName);
            }
            dirty = true;
            debugLog("PDCA", "syncStatusWithDocs: doc added to existing feature", { featureName, docType });
          }
        }
      } catch {
        // Directory read failed, skip
      }
    }
  }

  // Infer "do" phase for features stuck in "design".
  // "do" has no corresponding docs/ folder (unlike plan→01-plan, design→02-design),
  // so it can't be detected by the docs scan above.
  // Strategy: git (accurate) → filesystem mtime fallback (no git required).
  for (const [featureName, feat] of Object.entries(status.features)) {
    if (feat.phase !== "design" || !feat.documents?.design) continue;

    if (inferDoPhaseFromGit(directory, feat) || inferDoPhaseFromFs(directory, feat)) {
      applyPhaseToStatus(status, "do", featureName);
      dirty = true;
      debugLog("PDCA", "syncStatusWithDocs: inferred 'do' phase", { featureName });
    }
  }

  if (dirty) {
    await savePdcaStatus(directory, status);
    debugLog("PDCA", "syncStatusWithDocs: status synced", {
      features: Object.keys(status.features).join(", "),
    });
  }
  return dirty;
}

/**
 * Updates the phase of a feature in the status file.
 *
 * If `feature` is omitted the `primaryFeature` from the status is used. When
 * the feature does not yet exist in the status it is created and also set as
 * the primary feature.
 */
export async function updateFeaturePhase(
  directory: string,
  phase: string,
  feature?: string
): Promise<void> {
  const path = statusFilePath(directory);
  const status = await getPdcaStatus(directory);
  const now = new Date().toISOString();

  const featureName = feature ?? status.primaryFeature;
  if (!featureName) {
    throw new Error(
      "No feature specified and no primaryFeature set in PDCA status."
    );
  }

  const validPhases = [
    "research",
    "plan",
    "design",
    "do",
    "check",
    "act",
    "completed",
    "archived",
  ];
  if (!validPhases.includes(phase)) {
    throw new Error(
      `Invalid phase "${phase}". Must be one of: ${validPhases.join(", ")}`
    );
  }

  const phaseNumber = getPhaseNumber(phase);
  const existing = status.features[featureName];

  if (existing) {
    existing.phase = phase as PdcaFeature["phase"];
    existing.phaseNumber = phaseNumber;
    existing.lastUpdated = now;
    // Keep timestamps object in sync
    if (!existing.timestamps) {
      existing.timestamps = { started: existing.startedAt, lastUpdated: now };
    } else {
      existing.timestamps.lastUpdated = now;
    }
  } else {
    // Create new feature entry with full v2 fields
    status.features[featureName] = {
      phase: phase as PdcaFeature["phase"],
      phaseNumber,
      startedAt: now,
      lastUpdated: now,
      timestamps: {
        started: now,
        lastUpdated: now,
      },
    };
    // Auto-set as primary if none set
    if (!status.primaryFeature) {
      status.primaryFeature = featureName;
    }
    // Add to activeFeatures
    if (!status.activeFeatures.includes(featureName)) {
      status.activeFeatures.push(featureName);
    }
  }

  // Keep activeFeatures in sync: remove if archived/completed
  if (phase === "archived" || phase === "completed") {
    status.activeFeatures = status.activeFeatures.filter(
      (f) => f !== featureName
    );
    // If this was the primary, pick next active or clear
    if (status.primaryFeature === featureName) {
      status.primaryFeature = status.activeFeatures[0] ?? undefined;
    }
  } else if (!status.activeFeatures.includes(featureName)) {
    status.activeFeatures.push(featureName);
  }

  // Record phase transition in history
  if (!status.history) status.history = [];
  status.history.push({
    timestamp: now,
    feature: featureName,
    phase,
    action: existing ? "phase_updated" : "created",
  });
  trimHistory(status);

  // Update session activity
  if (!status.session) status.session = {};
  status.session.lastActivity = now;

  status.lastUpdated = now;

  try {
    writeJsonFile(path, status);
    // Invalidate system prompt cache so LLM sees updated phase immediately
    cache.invalidate("bkit-system-prompt");
    debugLog("PDCA", "Feature phase updated", { feature: featureName, phase, phaseNumber });
  } catch (e: any) {
    debugLog("PDCA", "Failed to update feature phase", { feature: featureName, phase, error: e.message });
  }
}

/**
 * Formats the PDCA status as human-readable text.
 *
 * When `feature` is specified only that feature is shown. Otherwise the
 * primary feature (or all active features) are displayed.
 */
export function formatPdcaStatus(status: PdcaStatus, feature?: string): string {
  const lines: string[] = [];

  const phaseOrder = [
    "research",
    "plan",
    "design",
    "do",
    "check",
    "act",
  ] as const;

  const phaseLabels: Record<string, string> = {
    research: "Research",
    plan: "Plan",
    design: "Design",
    do: "Do",
    check: "Check",
    act: "Act",
  };

  function buildProgressBar(feat: PdcaFeature): string {
    const parts: string[] = [];
    const currentIdx = phaseOrder.indexOf(feat.phase as (typeof phaseOrder)[number]);

    for (const p of phaseOrder) {
      const label = phaseLabels[p];
      const idx = phaseOrder.indexOf(p);

      if (feat.phase === "completed" || feat.phase === "archived") {
        // All done
        parts.push(`[${label}] \u2705`);
      } else if (feat.phase === p) {
        // Currently active phase
        parts.push(`[${label}] \u{1F504}`);
      } else if (idx < currentIdx) {
        // Completed phase
        parts.push(`[${label}] \u2705`);
      }
      // Future phases: omitted
    }
    return parts.join(" \u2192 ");
  }

  function formatSingleFeature(name: string, feat: PdcaFeature): void {
    lines.push(`Feature: ${name}`);

    const phaseDisplay =
      feat.phase === "completed"
        ? "Completed"
        : feat.phase === "archived"
          ? "Archived"
          : phaseLabels[feat.phase] ?? feat.phase;

    lines.push(`Phase: ${phaseDisplay}`);

    if (feat.matchRate !== undefined) {
      lines.push(`Match Rate: ${feat.matchRate}%`);
    }
    if (feat.iterations !== undefined) {
      lines.push(`Iteration: ${feat.iterations}/5`);
    }
    if (feat.documents?.research) {
      lines.push(`Research: ${feat.documents.research}`);
    }
    if (feat.evalScores) {
      const scores = Object.entries(feat.evalScores)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${v}pt`)
        .join(", ");
      if (scores) lines.push(`Eval Scores: ${scores}`);
    }

    lines.push(`Started: ${feat.startedAt}`);
    lines.push(`Updated: ${feat.lastUpdated}`);
    lines.push("─".repeat(35));
    lines.push(buildProgressBar(feat));
  }

  lines.push("PDCA Status");
  lines.push("─".repeat(35));

  if (feature) {
    // Show specific feature
    const feat = status.features[feature];
    if (!feat) {
      lines.push(`Feature "${feature}" not found.`);
    } else {
      formatSingleFeature(feature, feat);
    }
  } else if (status.primaryFeature && status.features[status.primaryFeature]) {
    // Show primary feature
    formatSingleFeature(
      status.primaryFeature,
      status.features[status.primaryFeature]
    );

    // List other active features if any
    const others = status.activeFeatures.filter(
      (f) => f !== status.primaryFeature
    );
    if (others.length > 0) {
      lines.push("");
      lines.push(`Other active features: ${others.join(", ")}`);
    }
  } else if (status.activeFeatures.length > 0) {
    // Show all active features
    for (const name of status.activeFeatures) {
      const feat = status.features[name];
      if (feat) {
        formatSingleFeature(name, feat);
        lines.push("");
      }
    }
  } else {
    lines.push("No active features.");
    lines.push('Start with: /pdca plan [feature-name]');
  }

  return lines.join("\n");
}

// isSourceFile() removed — duplicate of lib/core/file.ts version.
// Import from "../core/file" instead.

// ---------------------------------------------------------------------------
// Archive & Cleanup helpers
// ---------------------------------------------------------------------------

/**
 * Returns all features whose phase is "archived".
 */
export function getArchivedFeatures(
  status: PdcaStatus
): Record<string, PdcaFeature> {
  const result: Record<string, PdcaFeature> = {};
  for (const [name, feat] of Object.entries(status.features)) {
    if (feat.phase === "archived") {
      result[name] = feat;
    }
  }
  return result;
}

/**
 * Removes the specified features from the status. If no list is given, all
 * archived features are removed. Returns the names of removed features.
 */
export async function cleanupArchivedFeatures(
  directory: string,
  featureNames?: string[]
): Promise<string[]> {
  const path = statusFilePath(directory);
  const status = await getPdcaStatus(directory);
  const now = new Date().toISOString();

  const toRemove = featureNames ?? Object.keys(getArchivedFeatures(status));
  const removed: string[] = [];

  for (const name of toRemove) {
    const feat = status.features[name];
    if (feat && (feat.phase === "archived" || feat.phase === "completed")) {
      delete status.features[name];
      status.activeFeatures = status.activeFeatures.filter((f) => f !== name);
      if (status.primaryFeature === name) {
        status.primaryFeature = status.activeFeatures[0] ?? undefined;
      }
      removed.push(name);
    }
  }

  if (removed.length > 0) {
    status.lastUpdated = now;
    try {
      writeJsonFile(path, status);
    } catch (e: any) {
      debugLog("PDCA", "Failed to write after cleanup", { error: e.message });
    }
  }

  return removed;
}

/**
 * Enforces a maximum number of features in the status file by auto-removing
 * the oldest archived features until the count is at or below `max`.
 */
export async function enforceFeatureLimit(
  directory: string,
  max: number = 50
): Promise<string[]> {
  const status = await getPdcaStatus(directory);
  const totalCount = Object.keys(status.features).length;

  if (totalCount <= max) return [];

  // Gather archived features sorted by archivedAt (oldest first)
  const archived = Object.entries(status.features)
    .filter(([, f]) => f.phase === "archived")
    .sort(
      ([, a], [, b]) =>
        new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime()
    );

  const removeCount = totalCount - max;
  const toRemove = archived.slice(0, removeCount).map(([name]) => name);

  if (toRemove.length > 0) {
    return cleanupArchivedFeatures(directory, toRemove);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Feature Metrics (FR-02: matchRate, iterations update from agent output)
// ---------------------------------------------------------------------------

/**
 * Update metrics (matchRate, iterations) for a feature without changing its phase.
 * Called from tool-after hook when gap-detector or pdca-iterator results are parsed.
 */
export async function updateFeatureMetrics(
  directory: string,
  feature: string,
  metrics: { matchRate?: number; iterations?: number }
): Promise<void> {
  const path = statusFilePath(directory);
  const status = await getPdcaStatus(directory);
  const feat = status.features[feature];
  if (!feat) {
    debugLog("PDCA", "updateFeatureMetrics: feature not found", { feature });
    return;
  }

  const now = new Date().toISOString();
  if (metrics.matchRate !== undefined) feat.matchRate = metrics.matchRate;
  if (metrics.iterations !== undefined) {
    feat.iterations = metrics.iterations;
    feat.iterationCount = metrics.iterations; // v2 compat
  }
  feat.lastUpdated = now;
  if (feat.timestamps) feat.timestamps.lastUpdated = now;
  status.lastUpdated = now;

  try {
    writeJsonFile(path, status);
    cache.invalidate("bkit-system-prompt");
    debugLog("PDCA", "Feature metrics updated", { feature, ...metrics });
  } catch (e: any) {
    debugLog("PDCA", "Failed to update feature metrics", { feature, error: e.message });
  }
}

/**
 * Update the documents field for a feature (plan, design, analysis, report paths).
 * Called from tool-after hook when PDCA docs are written.
 */
export async function updateFeatureDocuments(
  directory: string,
  feature: string,
  docType: "plan" | "design" | "analysis" | "report" | "research",
  relativePath: string
): Promise<void> {
  const path = statusFilePath(directory);
  const status = await getPdcaStatus(directory);
  const feat = status.features[feature];
  if (!feat) {
    debugLog("PDCA", "updateFeatureDocuments: feature not found", { feature });
    return;
  }

  if (!feat.documents) feat.documents = {};
  feat.documents[docType] = relativePath;

  const now = new Date().toISOString();
  feat.lastUpdated = now;
  if (feat.timestamps) feat.timestamps.lastUpdated = now;
  status.lastUpdated = now;

  // Update session activity
  if (!status.session) status.session = {};
  status.session.lastActivity = now;

  try {
    writeJsonFile(path, status);
    cache.invalidate("bkit-system-prompt");
    debugLog("PDCA", "Feature document updated", { feature, docType, relativePath });
  } catch (e: any) {
    debugLog("PDCA", "Failed to update feature documents", { feature, error: e.message });
  }
}

// ---------------------------------------------------------------------------
// In-memory mutation helpers (for batched I/O in tool-after)
// ---------------------------------------------------------------------------

/**
 * Apply a phase update to an in-memory PdcaStatus object WITHOUT file I/O.
 * Use with savePdcaStatus() to batch multiple mutations into a single write.
 *
 * Returns the resolved feature name, or null if no feature could be resolved.
 */
export function applyPhaseToStatus(
  status: PdcaStatus,
  phase: string,
  feature?: string,
): string | null {
  const now = new Date().toISOString();
  const featureName = feature ?? status.primaryFeature;
  if (!featureName) return null;

  const validPhases = ["research", "plan", "design", "do", "check", "act", "completed", "archived"];
  if (!validPhases.includes(phase)) return null;

  const phaseNumber = getPhaseNumber(phase);
  const existing = status.features[featureName];

  if (existing) {
    existing.phase = phase as PdcaFeature["phase"];
    existing.phaseNumber = phaseNumber;
    existing.lastUpdated = now;
    if (!existing.timestamps) {
      existing.timestamps = { started: existing.startedAt, lastUpdated: now };
    } else {
      existing.timestamps.lastUpdated = now;
    }
  } else {
    status.features[featureName] = {
      phase: phase as PdcaFeature["phase"],
      phaseNumber,
      startedAt: now,
      lastUpdated: now,
      timestamps: { started: now, lastUpdated: now },
    };
    if (!status.primaryFeature) {
      status.primaryFeature = featureName;
    }
    if (!status.activeFeatures.includes(featureName)) {
      status.activeFeatures.push(featureName);
    }
  }

  // Keep activeFeatures in sync
  if (phase === "archived" || phase === "completed") {
    status.activeFeatures = status.activeFeatures.filter(f => f !== featureName);
    if (status.primaryFeature === featureName) {
      status.primaryFeature = status.activeFeatures[0] ?? undefined;
    }
  } else if (!status.activeFeatures.includes(featureName)) {
    status.activeFeatures.push(featureName);
  }

  // History
  if (!status.history) status.history = [];
  status.history.push({
    timestamp: now,
    feature: featureName,
    phase,
    action: existing ? "phase_updated" : "created",
  });
  trimHistory(status);

  // Session activity
  if (!status.session) status.session = {};
  status.session.lastActivity = now;
  status.lastUpdated = now;

  return featureName;
}

/**
 * Apply a document path update to an in-memory PdcaStatus object WITHOUT file I/O.
 */
export function applyDocumentToStatus(
  status: PdcaStatus,
  feature: string,
  docType: "plan" | "design" | "analysis" | "report" | "research",
  relativePath: string,
): boolean {
  const feat = status.features[feature];
  if (!feat) return false;

  if (!feat.documents) feat.documents = {};
  feat.documents[docType] = relativePath;

  const now = new Date().toISOString();
  feat.lastUpdated = now;
  if (feat.timestamps) feat.timestamps.lastUpdated = now;
  status.lastUpdated = now;

  if (!status.session) status.session = {};
  status.session.lastActivity = now;

  return true;
}

/**
 * Apply metrics updates to an in-memory PdcaStatus object WITHOUT file I/O.
 * Use with savePdcaStatus() to batch multiple mutations into a single write.
 * B3 fix: Replaces separate updateFeatureMetrics() calls that each did read→write.
 */
export function applyMetricsToStatus(
  status: PdcaStatus,
  feature: string,
  metrics: { matchRate?: number; iterations?: number },
): boolean {
  const feat = status.features[feature];
  if (!feat) return false;

  const now = new Date().toISOString();
  let changed = false;

  if (metrics.matchRate !== undefined) {
    feat.matchRate = metrics.matchRate;
    changed = true;
  }
  if (metrics.iterations !== undefined) {
    feat.iterations = metrics.iterations;
    feat.iterationCount = metrics.iterations; // v2 compat
    changed = true;
  }

  if (changed) {
    feat.lastUpdated = now;
    if (feat.timestamps) feat.timestamps.lastUpdated = now;
    status.lastUpdated = now;
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Save helper
// ---------------------------------------------------------------------------

export async function savePdcaStatus(
  directory: string,
  status: PdcaStatus
): Promise<void> {
  const path = statusFilePath(directory);
  status.lastUpdated = new Date().toISOString();
  try {
    writeJsonFile(path, status);
    // FR-02.3: Write-through — update cache immediately after disk write
    _statusCache = { data: status, ts: Date.now(), directory };
    // Invalidate system prompt cache so LLM sees updated state immediately
    cache.invalidate("bkit-system-prompt");
  } catch (e: any) {
    debugLog("PDCA", "Failed to save PDCA status", { path, error: e.message });
  }
}

/** FR-02.3: Explicitly invalidate the write-through cache (e.g. after external file edits). */
export function invalidateStatusCache(): void {
  _statusCache = null;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Append a history entry to the status file. Keeps last 100 entries. */
export async function addPdcaHistory(
  directory: string,
  entry: Record<string, unknown>
): Promise<void> {
  const status = await getPdcaStatus(directory);
  if (!status.history) status.history = [];

  status.history.push({ timestamp: new Date().toISOString(), ...entry } as PdcaHistoryEntry);
  trimHistory(status);

  await savePdcaStatus(directory, status);
}

// ---------------------------------------------------------------------------
// Feature lifecycle
// ---------------------------------------------------------------------------

/** Mark a feature as completed. */
export async function completePdcaFeature(
  directory: string,
  feature: string
): Promise<void> {
  await updateFeaturePhase(directory, "completed", feature);
  await addPdcaHistory(directory, {
    feature,
    phase: "completed",
    action: "feature_completed",
  });
}

/** Delete a feature from the status file. Only archived/completed features can be deleted. */
export async function deleteFeatureFromStatus(
  directory: string,
  feature: string
): Promise<{ success: boolean; reason?: string }> {
  const status = await getPdcaStatus(directory);

  if (!status.features[feature]) {
    return { success: false, reason: "Feature not found" };
  }

  const feat = status.features[feature];
  if (
    status.activeFeatures.includes(feature) &&
    feat.phase !== "archived" &&
    feat.phase !== "completed"
  ) {
    return { success: false, reason: "Cannot delete active feature" };
  }

  delete status.features[feature];
  status.activeFeatures = status.activeFeatures.filter((f) => f !== feature);
  if (status.primaryFeature === feature) {
    status.primaryFeature = status.activeFeatures[0] ?? undefined;
  }

  if (!status.history) status.history = [];
  status.history.push({
    timestamp: new Date().toISOString(),
    action: "feature_deleted",
    feature,
  } as PdcaHistoryEntry);
  trimHistory(status);

  await savePdcaStatus(directory, status);
  debugLog("PDCA", `Feature deleted: ${feature}`);
  return { success: true };
}

/** Convert a feature to a lightweight archived summary (FR-04). */
export async function archiveFeatureToSummary(
  directory: string,
  feature: string
): Promise<{ success: boolean; reason?: string }> {
  const status = await getPdcaStatus(directory);

  if (!status.features[feature]) {
    return { success: false, reason: "Feature not found" };
  }

  const full = status.features[feature];
  if (full.phase !== "archived" && full.phase !== "completed") {
    return { success: false, reason: "Feature must be archived or completed" };
  }

  // Replace with lightweight summary
  status.features[feature] = {
    phase: "archived",
    matchRate: full.matchRate,
    iterations: full.iterations ?? 0,
    startedAt: full.startedAt,
    lastUpdated: new Date().toISOString(),
    archivedAt: full.archivedAt ?? new Date().toISOString(),
    archivedTo: full.archivedTo ?? undefined,
  };

  status.activeFeatures = status.activeFeatures.filter((f) => f !== feature);
  if (status.primaryFeature === feature) {
    status.primaryFeature = status.activeFeatures[0] ?? undefined;
  }

  await savePdcaStatus(directory, status);
  debugLog("PDCA", `Feature summarized: ${feature}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Active feature management
// ---------------------------------------------------------------------------

/** Set the primary active feature. */
export async function setActiveFeature(
  directory: string,
  feature: string
): Promise<void> {
  const status = await getPdcaStatus(directory);
  status.primaryFeature = feature;
  if (!status.activeFeatures.includes(feature)) {
    status.activeFeatures.push(feature);
  }
  await savePdcaStatus(directory, status);
  debugLog("PDCA", "Set active feature", { feature });
}

/** Add a feature to the active list. */
export async function addActiveFeature(
  directory: string,
  feature: string,
  setAsPrimary = false
): Promise<void> {
  const status = await getPdcaStatus(directory);
  if (!status.activeFeatures.includes(feature)) {
    status.activeFeatures.push(feature);
  }
  if (setAsPrimary) {
    status.primaryFeature = feature;
  }
  await savePdcaStatus(directory, status);
}

/** Remove a feature from the active list. */
export async function removeActiveFeature(
  directory: string,
  feature: string
): Promise<void> {
  const status = await getPdcaStatus(directory);
  status.activeFeatures = status.activeFeatures.filter((f) => f !== feature);
  if (status.primaryFeature === feature) {
    status.primaryFeature = status.activeFeatures[0] ?? undefined;
  }
  await savePdcaStatus(directory, status);
}

/** Get all active feature names. */
export async function getActiveFeatures(
  directory: string
): Promise<string[]> {
  const status = await getPdcaStatus(directory);
  return status.activeFeatures;
}

/** Switch the primary feature to a different one. Returns false if the feature does not exist. */
export async function switchFeatureContext(
  directory: string,
  feature: string
): Promise<boolean> {
  const status = await getPdcaStatus(directory);
  if (!status.features[feature]) return false;
  status.primaryFeature = feature;
  if (!status.activeFeatures.includes(feature)) {
    status.activeFeatures.push(feature);
  }
  await savePdcaStatus(directory, status);
  return true;
}

/** Extract a feature name from file path or fall back to primaryFeature. */
export async function extractFeatureFromContext(
  directory: string,
  sources: { feature?: string; filePath?: string } = {}
): Promise<string> {
  if (sources.feature) return sources.feature;

  if (sources.filePath) {
    const featurePatterns = ["features", "modules", "packages", "domains"];
    for (const pattern of featurePatterns) {
      const regex = new RegExp(`${pattern}/([^/]+)`);
      const match = sources.filePath.match(regex);
      if (match?.[1]) return match[1];
    }
  }

  const status = await getPdcaStatus(directory);
  return status.primaryFeature ?? "";
}

// ---------------------------------------------------------------------------
// bkit Memory read/write
// ---------------------------------------------------------------------------

/** Read docs/.bkit-memory.json from the project directory. */
export function readBkitMemory(directory: string): Record<string, unknown> | null {
  const memoryPath = join(directory, "docs", ".bkit-memory.json");
  try {
    if (existsSync(memoryPath)) {
      return JSON.parse(readFileSync(memoryPath, "utf8"));
    }
  } catch {
    // Silently fail
  }
  return null;
}

/** Write docs/.bkit-memory.json to the project directory. */
export function writeBkitMemory(
  directory: string,
  memory: Record<string, unknown>
): boolean {
  const memoryPath = join(directory, "docs", ".bkit-memory.json");
  try {
    const dir = dirname(memoryPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(memoryPath, JSON.stringify(memory, null, 2) + "\n", "utf8");
    return true;
  } catch (e: any) {
    debugLog("PDCA", "Failed to write bkit-memory", { error: e?.message });
    return false;
  }
}
