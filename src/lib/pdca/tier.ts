/**
 * Language Tier Classification
 * Classifies programming languages into tiers for PDCA guidance.
 * Ported from bkit-claude-code lib/pdca/tier.js to TypeScript for OpenCode.
 *
 * Tiers indicate the maturity and AI-support level of a language:
 * - Tier 1: Primary languages with best AI tooling support
 * - Tier 2: Well-supported UI/web/mobile languages
 * - Tier 3: Systems languages with moderate AI support
 * - Tier 4: Scripting/shell languages
 * - Experimental: Emerging languages with limited AI support
 */

import { extname } from "path"
import { TIER_EXTENSIONS } from "../core/file"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TierLevel = 1 | 2 | 3 | 4 | "experimental"

// ---------------------------------------------------------------------------
// Internal lookup
// ---------------------------------------------------------------------------

const extensionToTier = new Map<string, TierLevel>()

for (const [tier, extensions] of Object.entries(TIER_EXTENSIONS)) {
  const tierKey = tier === "experimental" ? "experimental" : (Number(tier) as 1 | 2 | 3 | 4)
  for (const ext of extensions) {
    extensionToTier.set(ext.toLowerCase(), tierKey)
  }
}

// ---------------------------------------------------------------------------
// Tier descriptions
// ---------------------------------------------------------------------------

const TIER_DESCRIPTIONS: Record<string, string> = {
  "1": "Tier 1 - Primary languages with best AI tooling (TypeScript, Python, Go, Rust, Java, Kotlin)",
  "2": "Tier 2 - Well-supported UI/web/mobile languages (Vue, Svelte, Astro, PHP, Ruby, Swift, Scala)",
  "3": "Tier 3 - Systems languages with moderate AI support (C, C++, C#, Objective-C)",
  "4": "Tier 4 - Scripting/shell languages (Bash, Zsh, PowerShell, Batch)",
  experimental: "Experimental - Emerging languages with limited AI support (Zig, Nim, V, Odin, Jai)",
}

const TIER_PDCA_GUIDANCE: Record<string, string> = {
  "1": "Full PDCA cycle recommended. AI agents can handle plan, design, implementation, and verification with high accuracy.",
  "2": "Full PDCA cycle supported. AI agents handle most phases well; manual review recommended for framework-specific patterns.",
  "3": "PDCA cycle supported with caveats. AI handles plan/design well; implementation may need more manual oversight for memory management and platform specifics.",
  "4": "Simplified PDCA recommended. Focus on plan and implementation phases. Scripts benefit from manual testing over automated gap analysis.",
  experimental: "Minimal PDCA support. AI knowledge may be limited. Rely on manual verification and community documentation.",
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the tier level for a file path or extension.
 * Returns null if the extension is not recognized.
 */
export function getLanguageTier(filePathOrExt: string): TierLevel | null {
  const ext = filePathOrExt.startsWith(".")
    ? filePathOrExt.toLowerCase()
    : extname(filePathOrExt).toLowerCase()

  if (!ext) return null
  return extensionToTier.get(ext) ?? null
}

/**
 * Get a human-readable description for a tier level.
 */
export function getTierDescription(tier: TierLevel): string {
  return TIER_DESCRIPTIONS[String(tier)] ?? "Unknown tier"
}

/**
 * Get PDCA-specific guidance for a tier level.
 */
export function getTierPdcaGuidance(tier: TierLevel): string {
  return TIER_PDCA_GUIDANCE[String(tier)] ?? "No specific guidance available for this tier."
}

/** Check if a file/extension belongs to Tier 1 */
export function isTier1(filePathOrExt: string): boolean {
  return getLanguageTier(filePathOrExt) === 1
}

/** Check if a file/extension belongs to Tier 2 */
export function isTier2(filePathOrExt: string): boolean {
  return getLanguageTier(filePathOrExt) === 2
}

/** Check if a file/extension belongs to Tier 3 */
export function isTier3(filePathOrExt: string): boolean {
  return getLanguageTier(filePathOrExt) === 3
}

/** Check if a file/extension belongs to Tier 4 */
export function isTier4(filePathOrExt: string): boolean {
  return getLanguageTier(filePathOrExt) === 4
}

/** Check if a file/extension belongs to the Experimental tier */
export function isExperimentalTier(filePathOrExt: string): boolean {
  return getLanguageTier(filePathOrExt) === "experimental"
}
