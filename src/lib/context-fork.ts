/**
 * Context Fork Module
 * In-memory fork storage for parallel PDCA execution contexts.
 * Ported from bkit-claude-code lib/context-fork.js to TypeScript for OpenCode.
 *
 * Forks allow branching a PDCA context so that sub-agents can work on
 * variations (e.g. different implementation approaches) without mutating
 * the parent context.  Each fork captures a snapshot of the PDCA status
 * at creation time and can later be merged back.
 */

import { debugLog } from "./core/debug"
import { getPdcaStatus, type PdcaStatus } from "./pdca/status"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForkMetadata {
  parentId: string | null
  reason: string
  createdBy: string
  phase: string
  feature: string
}

export interface Fork {
  id: string
  parentId: string | null
  reason: string
  createdBy: string
  phase: string
  feature: string
  createdAt: string
  lastUpdatedAt: string
  state: Record<string, unknown>
  active: boolean
}

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

const forkStore = new Map<string, Fork>()
let _forkIdCounter = 0

function generateForkId(feature: string): string {
  _forkIdCounter++
  return `fork-${feature}-${_forkIdCounter}-${Date.now().toString(36)}`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new fork from the current PDCA context.
 * Captures a snapshot of the current PDCA status as the fork's initial state.
 */
export async function forkContext(
  directory: string,
  options: {
    feature: string
    phase: string
    reason?: string
    createdBy?: string
    parentId?: string
  },
): Promise<Fork> {
  const status = await getPdcaStatus(directory)
  const id = generateForkId(options.feature)

  const fork: Fork = {
    id,
    parentId: options.parentId ?? null,
    reason: options.reason ?? "parallel execution",
    createdBy: options.createdBy ?? "system",
    phase: options.phase,
    feature: options.feature,
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    state: {
      pdcaStatus: JSON.parse(JSON.stringify(status)),
      custom: {},
    },
    active: true,
  }

  forkStore.set(id, fork)

  debugLog("context-fork", "Fork created", {
    id,
    feature: options.feature,
    phase: options.phase,
    parentId: fork.parentId,
  })

  return fork
}

/**
 * Retrieve a forked context by its ID.
 * Returns null if the fork does not exist.
 */
export function getForkedContext(forkId: string): Fork | null {
  return forkStore.get(forkId) ?? null
}

/**
 * Update the state of an existing fork.
 * Merges the provided partial state into the fork's current state.
 */
export function updateForkedContext(
  forkId: string,
  updates: Record<string, unknown>,
): boolean {
  const fork = forkStore.get(forkId)
  if (!fork) return false

  Object.assign(fork.state, updates)
  fork.lastUpdatedAt = new Date().toISOString()

  debugLog("context-fork", "Fork updated", { forkId })
  return true
}

/**
 * Merge a fork's state back into the main PDCA context.
 * The fork is marked as inactive after merging.
 * Returns the merged PDCA status snapshot from the fork.
 */
export function mergeForkedContext(forkId: string): Record<string, unknown> | null {
  const fork = forkStore.get(forkId)
  if (!fork) return null

  fork.active = false
  fork.lastUpdatedAt = new Date().toISOString()

  debugLog("context-fork", "Fork merged", {
    forkId,
    feature: fork.feature,
    phase: fork.phase,
  })

  return { ...fork.state }
}

/**
 * Check whether a given fork ID corresponds to an active forked execution.
 */
export function isForkedExecution(forkId: string): boolean {
  const fork = forkStore.get(forkId)
  return fork != null && fork.active
}

/**
 * Discard a fork without merging.
 * Removes it from the store entirely.
 */
export function discardFork(forkId: string): boolean {
  const existed = forkStore.delete(forkId)
  if (existed) {
    debugLog("context-fork", "Fork discarded", { forkId })
  }
  return existed
}

/**
 * Get all currently active forks.
 */
export function getActiveForks(): Fork[] {
  const active: Fork[] = []
  for (const fork of forkStore.values()) {
    if (fork.active) active.push(fork)
  }
  return active
}

/**
 * Get metadata for a fork without exposing the full state.
 */
export function getForkMetadata(forkId: string): ForkMetadata | null {
  const fork = forkStore.get(forkId)
  if (!fork) return null

  return {
    parentId: fork.parentId,
    reason: fork.reason,
    createdBy: fork.createdBy,
    phase: fork.phase,
    feature: fork.feature,
  }
}

/**
 * Clear all forks from the in-memory store.
 * Typically called on session end to prevent stale state.
 */
export function clearAllForks(): void {
  const count = forkStore.size
  forkStore.clear()
  _forkIdCounter = 0
  if (count > 0) {
    debugLog("context-fork", "All forks cleared", { clearedCount: count })
  }
}
