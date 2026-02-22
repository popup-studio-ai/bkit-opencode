/**
 * Multi-Level Context Hierarchy
 * Manages 4-level context: Plugin → User → Project → Session
 * Higher priority levels override lower ones.
 * Ported from bkit-claude-code lib/context-hierarchy.js
 */

import { join } from "path"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { debugLog } from "./core/debug"
import { getPluginRoot, getProjectDir } from "./core/platform"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEVEL_PRIORITY: Record<string, number> = {
  plugin: 1,
  user: 2,
  project: 3,
  session: 4,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextLevel {
  level: string
  priority: number
  source: string
  data: Record<string, unknown>
  loadedAt: string
}

export interface ContextHierarchy {
  levels: ContextLevel[]
  merged: Record<string, unknown>
  conflicts: Array<{
    key: string
    values: Array<{ level: string; value: unknown }>
    resolved: unknown
  }>
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _sessionContext: Record<string, unknown> = {}
let _hierarchyCache: { data: ContextHierarchy | null; timestamp: number } = {
  data: null,
  timestamp: 0,
}
const HIERARCHY_CACHE_TTL = 5000

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getUserConfigDir(): string {
  return join(homedir(), ".opencode", "bkit")
}

export function loadContextLevel(level: "plugin" | "user" | "project" | "session"): ContextLevel | null {
  const now = new Date().toISOString()

  switch (level) {
    case "plugin": {
      const pluginRoot = getPluginRoot()
      const configPath = join(pluginRoot, "..", "bkit.config.json")
      if (existsSync(configPath)) {
        try {
          return {
            level: "plugin",
            priority: LEVEL_PRIORITY.plugin,
            source: configPath,
            data: JSON.parse(readFileSync(configPath, "utf8")),
            loadedAt: now,
          }
        } catch (e: any) {
          debugLog("ContextHierarchy", "Failed to load plugin config", { error: e.message })
        }
      }
      return null
    }

    case "user": {
      const userConfigPath = join(getUserConfigDir(), "user-config.json")
      if (existsSync(userConfigPath)) {
        try {
          return {
            level: "user",
            priority: LEVEL_PRIORITY.user,
            source: userConfigPath,
            data: JSON.parse(readFileSync(userConfigPath, "utf8")),
            loadedAt: now,
          }
        } catch (e: any) {
          debugLog("ContextHierarchy", "Failed to load user config", { error: e.message })
        }
      }
      return null
    }

    case "project": {
      const projectDir = getProjectDir()
      const configPath = join(projectDir, "bkit.config.json")
      if (existsSync(configPath)) {
        try {
          return {
            level: "project",
            priority: LEVEL_PRIORITY.project,
            source: configPath,
            data: JSON.parse(readFileSync(configPath, "utf8")),
            loadedAt: now,
          }
        } catch (e: any) {
          debugLog("ContextHierarchy", "Failed to load project config", { error: e.message })
        }
      }
      return null
    }

    case "session": {
      return {
        level: "session",
        priority: LEVEL_PRIORITY.session,
        source: "memory",
        data: _sessionContext,
        loadedAt: now,
      }
    }

    default:
      return null
  }
}

export function getContextHierarchy(forceRefresh = false): ContextHierarchy {
  if (!forceRefresh && _hierarchyCache.data && Date.now() - _hierarchyCache.timestamp < HIERARCHY_CACHE_TTL) {
    return _hierarchyCache.data
  }

  const levels: ContextLevel[] = []
  for (const levelName of ["plugin", "user", "project", "session"] as const) {
    const level = loadContextLevel(levelName)
    if (level) levels.push(level)
  }

  levels.sort((a, b) => a.priority - b.priority)

  const merged: Record<string, unknown> = {}
  const keyHistory: Record<string, Array<{ level: string; value: unknown }>> = {}
  const conflicts: ContextHierarchy["conflicts"] = []

  for (const level of levels) {
    for (const [key, value] of Object.entries(level.data || {})) {
      if (key in merged && JSON.stringify(merged[key]) !== JSON.stringify(value)) {
        if (!keyHistory[key]) keyHistory[key] = []
        keyHistory[key].push({ level: level.level, value: merged[key] })
        conflicts.push({
          key,
          values: [...keyHistory[key], { level: level.level, value }],
          resolved: value,
        })
      }
      merged[key] = value
      keyHistory[key] = keyHistory[key] || []
      keyHistory[key].push({ level: level.level, value })
    }
  }

  const result: ContextHierarchy = { levels, merged, conflicts }
  _hierarchyCache = { data: result, timestamp: Date.now() }

  debugLog("ContextHierarchy", "Hierarchy loaded", {
    levelCount: levels.length,
    conflictCount: conflicts.length,
  })

  return result
}

export function getHierarchicalConfig(keyPath: string, defaultValue: unknown = null): unknown {
  const hierarchy = getContextHierarchy()
  const keys = keyPath.split(".")
  let value: unknown = hierarchy.merged

  for (const key of keys) {
    if (value && typeof value === "object" && key in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[key]
    } else {
      return defaultValue
    }
  }

  return value ?? defaultValue
}

export function setSessionContext(key: string, value: unknown): void {
  _sessionContext[key] = value
  _hierarchyCache.data = null
  debugLog("ContextHierarchy", "Session context set", { key })
}

export function getSessionContext<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  return key in _sessionContext ? (_sessionContext[key] as T) : defaultValue
}

export function clearSessionContext(): void {
  _sessionContext = {}
  _hierarchyCache.data = null
  debugLog("ContextHierarchy", "Session context cleared")
}

export function getAllSessionContext(): Record<string, unknown> {
  return { ..._sessionContext }
}

export function invalidateCache(): void {
  _hierarchyCache.data = null
}
