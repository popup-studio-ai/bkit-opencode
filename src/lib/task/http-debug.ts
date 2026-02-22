/**
 * Shared debug logging for delegate tools.
 *
 * Writes structured log lines to a file for production diagnostics.
 * Set BKIT_TASK_LOG env var to customise the output path.
 */

import { appendFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

// #9 fix: use user-specific temp path to avoid shared-file conflicts
const LOG_PATH = process.env["BKIT_TASK_LOG"]
  ?? join(tmpdir(), `bkit-task-debug-${process.getuid?.() ?? "default"}.log`)

/**
 * Write a structured debug line to the task debug log file.
 * @param prefix Module prefix (e.g. "task", "task-result")
 * @param label  Sub-label within the module
 * @param msg    Human-readable message
 * @param data   Optional structured data (JSON-serialised)
 */
export function taskDebugLog(prefix: string, label: string, msg: string, data?: any): void {
  try {
    const ts = new Date().toISOString().slice(11, 23)
    const line = `${ts} [${prefix}][${label}] ${msg}` + (data ? ` ${JSON.stringify(data)}` : "") + "\n"
    appendFileSync(LOG_PATH, line)
  } catch {}
}
