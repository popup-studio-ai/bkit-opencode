/**
 * Auto-commit on PDCA / pipeline phase changes.
 *
 * - plan/design/report/archived: stages `docs/` only (문서 변경)
 * - do/check/act: stages `docs/` + tracked source files (소스 코드 포함)
 *
 * `.bkit/` is gitignored by default (agent-state, shared-tasks, agent-activity
 * are excluded automatically).
 *
 * Non-fatal: errors are logged but never propagate.
 */

import { existsSync } from "fs"
import { join } from "path"
import { spawnSync } from "child_process"
import { debugLog } from "./debug"

/** Dedup: skip if same phase+feature was just committed in this process. */
let lastCommitKey = ""

/** Phases where source code changes are expected. */
const SOURCE_PHASES = new Set(["do", "check", "act"])

/**
 * Create an auto-commit after a PDCA or pipeline phase transition.
 *
 * @param directory  Project root directory
 * @param phase      New phase name (e.g. "plan", "design", "do")
 * @param feature    Feature name
 * @param type       "pdca" or "pipeline"
 */
export function autoCommitPhaseChange(
  directory: string,
  phase: string,
  feature: string,
  type: "pdca" | "pipeline" = "pdca",
): void {
  const key = `${directory}:${feature}:${phase}`
  if (key === lastCommitKey) return

  const gitDir = join(directory, ".git")
  if (!existsSync(gitDir)) return

  try {
    const spawnOpts = { cwd: directory, encoding: "utf-8" as const, timeout: 5000 }

    // Always stage docs/ (PDCA documents, .bkit-memory.json, .pdca-status.json)
    const docsDir = join(directory, "docs")
    if (existsSync(docsDir)) {
      spawnSync("git", ["add", "docs/"], spawnOpts)
    }

    // For implementation phases, also stage tracked source files
    if (SOURCE_PHASES.has(phase)) {
      // `git add -u` stages modifications/deletions of already-tracked files only.
      // Does NOT add new untracked files — safe from accidentally staging
      // .env, credentials, or other sensitive files.
      spawnSync("git", ["add", "-u"], spawnOpts)
    }

    // Check if there are staged changes
    const diffResult = spawnSync("git", ["diff", "--cached", "--quiet"], spawnOpts)
    if (diffResult.status === 0) {
      debugLog("AutoCommit", "No changes to commit", { phase, feature })
      return
    }

    // Commit
    const prefix = type === "pdca" ? "bkit(pdca)" : "bkit(pipeline)"
    const message = `${prefix}: ${phase} — ${feature}`

    const commitResult = spawnSync("git", ["commit", "-m", message], {
      ...spawnOpts,
      timeout: 10_000,
    })

    if (commitResult.status === 0) {
      lastCommitKey = key
      debugLog("AutoCommit", "Phase commit created", { phase, feature, type })
    } else {
      debugLog("AutoCommit", "Commit failed (non-fatal)", {
        stderr: commitResult.stderr?.slice(0, 200),
      })
    }
  } catch (e: any) {
    debugLog("AutoCommit", "Auto-commit error (non-fatal)", { error: e?.message })
  }
}
