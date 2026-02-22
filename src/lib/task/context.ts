/**
 * Active Context Management
 * Tracks which skill and agent are currently active in the session.
 * Ported from bkit-claude-code lib/task/context.js
 */

import { debugLog } from "../core/debug"

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _activeSkill: string | null = null
let _activeAgent: string | null = null
let _contextMetadata: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function setActiveSkill(skillName: string): void {
  _activeSkill = skillName
  debugLog("context", "Set active skill", { skill: skillName })
}

export function setActiveAgent(agentName: string): void {
  _activeAgent = agentName
  debugLog("context", "Set active agent", { agent: agentName })
}

export function getActiveSkill(): string | null {
  return _activeSkill
}

export function getActiveAgent(): string | null {
  return _activeAgent
}

export function clearActiveContext(): void {
  _activeSkill = null
  _activeAgent = null
  _contextMetadata = {}
  debugLog("context", "Cleared active context")
}

export function getActiveContext(): { skill: string | null; agent: string | null } {
  return { skill: _activeSkill, agent: _activeAgent }
}

export function hasActiveContext(): boolean {
  return _activeSkill !== null || _activeAgent !== null
}

export function setContextMetadata(key: string, value: unknown): void {
  _contextMetadata[key] = value
}

export function getContextMetadata<T = unknown>(key: string): T | null {
  return key in _contextMetadata ? (_contextMetadata[key] as T) : null
}
