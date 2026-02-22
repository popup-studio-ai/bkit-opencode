// bkit.config.json loader with caching and dot-notation access

import { existsSync, readFileSync } from "fs"
import { cache } from "./cache"
import { debugLog } from "./debug"
import { getPluginRoot } from "./platform"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdcaConfig {
  planDocPaths: string[]
  designDocPaths: string[]
  analysisDocPaths: string[]
  reportDocPaths: string[]
  statusFile: string
  matchRateThreshold: number
  autoIterate: boolean
  maxIterations: number
}

export interface AgentsConfig {
  levelBased: Record<string, string>
  taskBased: Record<string, string>
}

export interface OrchestrationPhases {
  plan: string
  design: string
  do: string
  check: string
  act: string
}

export interface TeamConfig {
  enabled: boolean
  maxTeammates: number
  orchestrationPatterns: Record<string, OrchestrationPhases>
}

export interface TierModel {
  providerID: string
  modelID: string
}

export interface ModelsConfig {
  opus: TierModel
  sonnet: TierModel
  haiku: TierModel
}

export interface LevelDetectionEntry {
  directories?: string[]
  files?: string[]
  packagePatterns?: string[]
}

export interface LevelDetectionConfig {
  enterprise: LevelDetectionEntry
  dynamic: LevelDetectionEntry
  default: string
}

export interface BkitConfig {
  version: string
  platform: string
  sourceDirectories: string[]
  codeExtensions: string[]
  pdca: PdcaConfig
  agents: AgentsConfig
  team: TeamConfig
  models: ModelsConfig
  levelDetection: LevelDetectionConfig
  permissions: Record<string, string>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const CONFIG_CACHE_KEY = "bkit:config"
const CONFIG_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Try to read and parse a JSON file.
 * Returns null if the file does not exist or cannot be parsed.
 */
function tryReadJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch (err) {
    debugLog("config", `Failed to read ${path}`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load `bkit.config.json`.
 *
 * Resolution order:
 *   1. `<directory>/bkit.config.json`  (project-level override)
 *   2. `<pluginRoot>/bkit.config.json` (plugin default)
 *
 * The result is cached for 5 minutes. Pass a different `directory` to
 * force a reload from a new location (the cache is keyed on a single
 * global slot so only one config is active at a time).
 */
export async function loadBkitConfig(directory: string): Promise<BkitConfig> {
  // Check cache first
  const cached = cache.get<BkitConfig>(CONFIG_CACHE_KEY)
  if (cached) {
    debugLog("config", "Returning cached config")
    return cached
  }

  // 1. Project-level config
  const projectPath = `${directory}/bkit.config.json`
  const projectConfig = tryReadJson<BkitConfig>(projectPath)

  if (projectConfig) {
    debugLog("config", `Loaded config from project: ${projectPath}`)
    cache.set(CONFIG_CACHE_KEY, projectConfig, CONFIG_TTL_MS)
    return projectConfig
  }

  // 2. Plugin-level fallback
  // getPluginRoot() returns src/; bkit.config.json is at plugin root (one level up)
  const pluginPath = `${getPluginRoot()}/../bkit.config.json`
  const pluginConfig = tryReadJson<BkitConfig>(pluginPath)

  if (pluginConfig) {
    debugLog("config", `Loaded config from plugin: ${pluginPath}`)
    cache.set(CONFIG_CACHE_KEY, pluginConfig, CONFIG_TTL_MS)
    return pluginConfig
  }

  throw new Error(
    `bkit.config.json not found in project (${projectPath}) or plugin root`
  )
}

/**
 * Return the currently cached config.
 * Throws if `loadBkitConfig` has not been called yet.
 */
export function getBkitConfig(): BkitConfig {
  const cached = cache.get<BkitConfig>(CONFIG_CACHE_KEY)
  if (!cached) {
    throw new Error(
      "Config not loaded yet. Call loadBkitConfig(directory) first."
    )
  }
  return cached
}

/**
 * Access a config value using dot-notation (e.g. `"team.enabled"`,
 * `"models.opus.modelID"`).
 *
 * Returns `defaultValue` (or `undefined`) when the path does not resolve.
 */
export function getConfig(key: string, defaultValue?: unknown): unknown {
  const config = cache.get<BkitConfig>(CONFIG_CACHE_KEY)
  if (!config) return defaultValue

  const segments = key.split(".")
  let current: unknown = config

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return defaultValue
    }
    current = (current as Record<string, unknown>)[segment]
  }

  return current !== undefined ? current : defaultValue
}
