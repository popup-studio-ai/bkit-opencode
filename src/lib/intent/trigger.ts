/**
 * Intent Detection / Trigger Matching
 *
 * Matches free-form user text against agent trigger patterns, skill trigger
 * patterns, and new-feature intent patterns to determine what the user likely
 * wants to do.
 */

import {
  AGENT_TRIGGER_PATTERNS,
  SKILL_TRIGGER_PATTERNS,
  NEW_FEATURE_KEYWORDS,
} from "./language";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMatch {
  agent: string;
  confidence: number;
}

export interface SkillMatch {
  skill: string;
}

export interface FeatureIntent {
  feature: string;
}

// ---------------------------------------------------------------------------
// Agent trigger matching
// ---------------------------------------------------------------------------

/**
 * Matches user text against `AGENT_TRIGGER_PATTERNS` and returns the best
 * matching agent with a confidence score (0-1).
 *
 * Confidence is computed as:
 *   (number of matching keywords for the agent) / (total keywords checked)
 *
 * Returns `null` when no keyword matches.
 */
export function matchImplicitAgentTrigger(
  text: string
): AgentMatch | null {
  if (!text || text.trim().length === 0) return null;

  const normalised = text.toLowerCase();

  let bestAgent: string | null = null;
  let bestScore = 0;
  let bestHits = 0;
  let bestLongestKeyword = 0;

  for (const [agent, patterns] of Object.entries(AGENT_TRIGGER_PATTERNS)) {
    let hits = 0;
    let longestHit = 0;

    for (const keyword of patterns) {
      if (normalised.includes(keyword.toLowerCase())) {
        hits++;
        if (keyword.length > longestHit) longestHit = keyword.length;
      }
    }

    if (hits === 0) continue;

    // Confidence: ratio of matched keywords to total keywords for this agent,
    // with a slight boost for agents with more absolute hits (multi-keyword
    // match is a stronger signal).
    const ratio = hits / patterns.length;
    const absoluteBoost = Math.min(hits * 0.05, 0.2);
    const score = Math.min(ratio + absoluteBoost, 1.0);

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
      bestHits = hits;
      bestLongestKeyword = longestHit;
    }
  }

  if (bestAgent === null) return null;

  // M-4 fix: Prevent false positives from short, common English words like
  // "help", "fix", "check", "right", "complete", "match", "guide".
  // Require either:
  //   - 2+ keyword hits (multi-keyword match is a reliable signal), OR
  //   - 1 hit where the keyword is >= 7 chars (distinctive words like
  //     "verify", "iterate", "optimize", "analyze" are unlikely to be noise)
  if (bestHits === 1 && bestLongestKeyword < 7) return null;

  return {
    agent: bestAgent,
    confidence: Math.round(bestScore * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Skill trigger matching
// ---------------------------------------------------------------------------

/**
 * Matches user text against `SKILL_TRIGGER_PATTERNS` and returns the best
 * matching skill, or `null` if nothing matches.
 */
export function matchImplicitSkillTrigger(
  text: string
): SkillMatch | null {
  if (!text || text.trim().length === 0) return null;

  const normalised = text.toLowerCase();

  let bestSkill: string | null = null;
  let bestHits = 0;

  for (const [skill, patterns] of Object.entries(SKILL_TRIGGER_PATTERNS)) {
    let hits = 0;

    for (const keyword of patterns) {
      if (normalised.includes(keyword.toLowerCase())) {
        hits++;
      }
    }

    if (hits > bestHits) {
      bestHits = hits;
      bestSkill = skill;
    }
  }

  if (bestSkill === null) return null;

  return { skill: bestSkill };
}

// ---------------------------------------------------------------------------
// New feature intent detection
// ---------------------------------------------------------------------------

/**
 * Detects whether the user text describes intent to create a new feature.
 *
 * Returns an object with the extracted `feature` name, or `null` if no
 * new-feature intent is detected.
 *
 * Feature name extraction heuristics:
 *  1. Look for patterns like "add X feature", "create X", "implement X"
 *  2. Extract the noun/phrase following the trigger keyword
 *  3. Normalise to kebab-case
 */
export function detectNewFeatureIntent(
  text: string
): FeatureIntent | null {
  if (!text || text.trim().length === 0) return null;

  const normalised = text.toLowerCase().trim();

  // Find the first matching trigger keyword
  let matchedKeyword: string | null = null;
  let matchIndex = -1;

  for (const keyword of NEW_FEATURE_KEYWORDS) {
    const kw = keyword.toLowerCase();
    const idx = normalised.indexOf(kw);
    if (idx !== -1) {
      // Prefer the earliest match, or the longest keyword at the same position
      if (
        matchIndex === -1 ||
        idx < matchIndex ||
        (idx === matchIndex && kw.length > (matchedKeyword?.length ?? 0))
      ) {
        matchedKeyword = kw;
        matchIndex = idx;
      }
    }
  }

  if (matchedKeyword === null) return null;

  // Extract the text after the keyword as the feature description
  const afterKeyword = text
    .slice(matchIndex + matchedKeyword.length)
    .trim();

  if (afterKeyword.length === 0) return null;

  const featureName = extractFeatureName(afterKeyword);
  if (!featureName) return null;

  return { feature: featureName };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a feature name from a phrase, normalising it to kebab-case.
 *
 * Examples:
 *   "a user authentication system"  -> "user-authentication-system"
 *   "the payment flow"              -> "payment-flow"
 *   "dark mode toggle"              -> "dark-mode-toggle"
 */
function extractFeatureName(phrase: string): string | null {
  // Remove leading articles and prepositions
  const stripped = phrase
    .replace(/^(a|an|the|some|for|to|that|which)\s+/i, "")
    .trim();

  if (stripped.length === 0) return null;

  // Take up to the first sentence-ending punctuation or newline
  const upToPunctuation = stripped.split(/[.!?\n,;:]/)[0]?.trim() ?? stripped;

  if (upToPunctuation.length === 0) return null;

  // Remove trailing common words like "feature", "functionality", "function"
  const cleaned = upToPunctuation
    .replace(
      /\s+(feature|functionality|function|system|module|component|page|screen)$/i,
      ""
    )
    .trim();

  if (cleaned.length === 0) return null;

  // Convert to kebab-case
  const kebab = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s\u3040-\u9FFF\uAC00-\uD7AF-]/g, "") // keep alphanumeric, spaces, CJK, Korean
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (kebab.length === 0) return null;

  // Limit feature name length
  const maxLen = 60;
  if (kebab.length > maxLen) {
    // Truncate at last whole word boundary
    const truncated = kebab.slice(0, maxLen);
    const lastDash = truncated.lastIndexOf("-");
    return lastDash > 10 ? truncated.slice(0, lastDash) : truncated;
  }

  return kebab;
}
