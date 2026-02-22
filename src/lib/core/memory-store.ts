/**
 * Memory Variable Store
 * Session-persistent storage for cross-session data.
 * Backed by docs/.bkit-memory.json in the project directory.
 * Ported from bkit-claude-code lib/memory-store.js
 */

import { join, dirname } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { debugLog } from "./debug"
import { getProjectDir } from "./platform"

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _memoryCache: Record<string, unknown> | null = null

function getMemoryFilePath(): string {
  return join(getProjectDir(), "docs", ".bkit-memory.json")
}

function loadMemory(): Record<string, unknown> {
  if (_memoryCache !== null) return _memoryCache

  const filePath = getMemoryFilePath()
  try {
    if (existsSync(filePath)) {
      _memoryCache = JSON.parse(readFileSync(filePath, "utf8"))
      return _memoryCache!
    }
  } catch (e: any) {
    debugLog("MemoryStore", "Failed to load memory", { error: e.message })
  }

  _memoryCache = {}
  return _memoryCache
}

function saveMemory(): void {
  const filePath = getMemoryFilePath()
  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, JSON.stringify(_memoryCache, null, 2) + "\n")
    debugLog("MemoryStore", "Memory saved")
  } catch (e: any) {
    debugLog("MemoryStore", "Failed to save memory", { error: e.message })
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getMemory<T = unknown>(key: string, defaultValue: T | null = null): T | null {
  const memory = loadMemory()
  return key in memory ? (memory[key] as T) : defaultValue
}

export function setMemory(key: string, value: unknown): void {
  loadMemory()
  _memoryCache![key] = value
  saveMemory()
}

export function deleteMemory(key: string): boolean {
  loadMemory()
  if (key in _memoryCache!) {
    delete _memoryCache![key]
    saveMemory()
    return true
  }
  return false
}

export function getAllMemory(): Record<string, unknown> {
  return { ...loadMemory() }
}

export function hasMemory(key: string): boolean {
  const memory = loadMemory()
  return key in memory
}

export function getMemoryKeys(): string[] {
  return Object.keys(loadMemory())
}

export function updateMemory(updates: Record<string, unknown>): void {
  loadMemory()
  Object.assign(_memoryCache!, updates)
  saveMemory()
}

export function clearMemory(): void {
  _memoryCache = {}
  saveMemory()
  debugLog("MemoryStore", "Memory cleared")
}

export function getMemoryPath(): string {
  return getMemoryFilePath()
}

export function invalidateCache(): void {
  _memoryCache = null
}
