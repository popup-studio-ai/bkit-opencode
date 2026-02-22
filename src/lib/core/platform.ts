// Platform detection and path management for OpenCode plugin
import { fileURLToPath } from "url"
import { dirname } from "path"

// import.meta.dir is Bun-only; fall back to import.meta.url for Node.js
const _defaultDir = typeof import.meta.dir === "string"
  ? import.meta.dir
  : dirname(fileURLToPath(import.meta.url))

let _directory = process.cwd()
let _worktree = process.cwd()
let _pluginRoot = _defaultDir

export const BKIT_PLATFORM = "opencode"

/**
 * Initialize platform paths. Call once during plugin startup.
 */
export function initPlatform(opts: {
  directory: string
  worktree: string
  pluginRoot: string
}) {
  _directory = opts.directory
  _worktree = opts.worktree
  _pluginRoot = opts.pluginRoot
}

/** Current project directory (where user code lives). */
export function getProjectDir(): string {
  return _directory
}

/** Git worktree root (may differ from project dir in worktree setups). */
export function getWorktree(): string {
  return _worktree
}

/** Root directory of the bkit-opencode plugin itself. */
export function getPluginRoot(): string {
  return _pluginRoot
}

/** Build an absolute path relative to the plugin root. */
export function getPluginPath(...segments: string[]): string {
  return [_pluginRoot, ...segments].join("/")
}

/** Build an absolute path relative to the project directory. */
export function getProjectPath(...segments: string[]): string {
  return [_directory, ...segments].join("/")
}
