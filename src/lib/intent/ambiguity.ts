// Ambiguity Analysis Module
// Calculates ambiguity score for user requests and generates clarifying questions.
// Ported from bkit-claude-code lib/intent/ambiguity.js to TypeScript for OpenCode.

import type { AgentMatch } from "./trigger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmbiguityResult {
  score: number
  factors: string[]
}

export interface ClarifyingQuestion {
  question: string
  header: string
  options: { label: string; description: string }[]
  multiSelect: boolean
}

// ---------------------------------------------------------------------------
// Detection Helpers
// ---------------------------------------------------------------------------

export function containsFilePath(text: string): boolean {
  if (!text) return false

  const filePathPatterns = [
    /\/[\w.-]+\/[\w.-]+/,
    /[A-Z]:\\[\w.-]+\\[\w.-]+/,
    /\.\/[\w.-]+/,
    /\.(js|ts|py|go|rs|java|tsx|jsx|vue|svelte|md|json|yaml|yml)$/i,
  ]

  return filePathPatterns.some((p) => p.test(text))
}

export function containsTechnicalTerms(text: string): boolean {
  if (!text) return false

  const technicalTerms = [
    "api", "database", "server", "client", "component", "module",
    "function", "class", "interface", "type", "schema", "endpoint",
    "authentication", "authorization", "middleware", "controller",
    "service", "repository", "model", "view", "hook", "context",
  ]

  const lowerText = text.toLowerCase()
  return technicalTerms.some((term) => lowerText.includes(term))
}

export function hasSpecificNouns(text: string): boolean {
  if (!text) return false

  return (
    /"[^"]+"/.test(text) ||
    /'[^']+'/.test(text) ||
    /[A-Z][a-z]+[A-Z][a-z]+/.test(text) ||
    /[a-z]+[A-Z][a-z]+/.test(text)
  )
}

export function hasScopeDefinition(text: string): boolean {
  if (!text) return false

  const scopePatterns = [
    /only|just|specifically|exactly/i,
    /all|every|entire|whole/i,
    /from\s+\w+\s+to\s+\w+/i,
    /in\s+the\s+\w+\s+(?:file|folder|directory|module)/i,
  ]

  return scopePatterns.some((p) => p.test(text))
}

export function hasMultipleInterpretations(text: string): boolean {
  if (!text) return false

  const ambiguousPatterns = [
    /maybe|perhaps|or|either/i,
    /it|this|that|those|these/i,
    /stuff|things|something/i,
    /fix|update|change|modify/i,
  ]

  const pronounCount = (text.match(/\b(it|this|that)\b/gi) || []).length

  return pronounCount >= 2 || ambiguousPatterns.some((p) => p.test(text))
}

// ---------------------------------------------------------------------------
// Context Conflict Detection
// ---------------------------------------------------------------------------

export function detectContextConflicts(
  request: string,
  context: { currentPhase?: string } = {},
): string[] {
  const conflicts: string[] = []

  if (context.currentPhase && request) {
    const phaseKeywords: Record<string, string[]> = {
      plan: ["implement", "code", "build", "deploy"],
      design: ["deploy", "test", "release"],
      do: ["plan", "design", "architecture"],
    }

    const currentKeywords = phaseKeywords[context.currentPhase] || []
    const lowerRequest = request.toLowerCase()

    for (const keyword of currentKeywords) {
      if (lowerRequest.includes(keyword)) {
        conflicts.push(
          `Request mentions "${keyword}" but current phase is "${context.currentPhase}"`,
        )
      }
    }
  }

  return conflicts
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

export function calculateAmbiguityScore(
  userRequest: string,
  context: { currentPhase?: string } = {},
): AmbiguityResult {
  const factors: string[] = []
  let score = 0

  if (!containsFilePath(userRequest)) {
    factors.push("no_file_path")
    score += 0.15
  }

  if (!containsTechnicalTerms(userRequest)) {
    factors.push("no_technical_terms")
    score += 0.1
  }

  if (!hasSpecificNouns(userRequest)) {
    factors.push("no_specific_nouns")
    score += 0.15
  }

  if (!hasScopeDefinition(userRequest)) {
    factors.push("no_scope")
    score += 0.1
  }

  if (hasMultipleInterpretations(userRequest)) {
    factors.push("multiple_interpretations")
    score += 0.2
  }

  const conflicts = detectContextConflicts(userRequest, context)
  if (conflicts.length > 0) {
    factors.push("context_conflict")
    score += 0.15 * conflicts.length
  }

  if (userRequest.length < 30) {
    factors.push("short_request")
    score += 0.15
  }

  score = Math.min(1, Math.max(0, score))

  return { score, factors }
}

export function generateClarifyingQuestions(
  userRequest: string,
  factors: string[] = [],
): ClarifyingQuestion[] {
  const questions: ClarifyingQuestion[] = []

  if (factors.includes("no_file_path")) {
    questions.push({
      question: "Which file or directory should I focus on?",
      header: "Location",
      options: [
        { label: "Current file", description: "The file we're currently working on" },
        { label: "Entire project", description: "Search the whole codebase" },
        { label: "Specific path", description: "I'll provide the path" },
      ],
      multiSelect: false,
    })
  }

  if (factors.includes("no_scope")) {
    questions.push({
      question: "What is the scope of this change?",
      header: "Scope",
      options: [
        { label: "Single file", description: "Change only one file" },
        { label: "Multiple files", description: "May affect several files" },
        { label: "Full feature", description: "Complete feature implementation" },
      ],
      multiSelect: false,
    })
  }

  if (factors.includes("multiple_interpretations")) {
    questions.push({
      question: "Could you be more specific about what you need?",
      header: "Clarification",
      options: [
        { label: "Add new code", description: "Create new functionality" },
        { label: "Modify existing", description: "Change current implementation" },
        { label: "Fix a bug", description: "Resolve an issue" },
        { label: "Refactor", description: "Improve without changing behavior" },
      ],
      multiSelect: false,
    })
  }

  return questions
}
