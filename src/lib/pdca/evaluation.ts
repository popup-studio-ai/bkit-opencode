/**
 * PDCA Document Evaluation
 *
 * Core evaluation module for plan/design document quality assessment.
 * Spawns a doc-evaluator agent in a separate session (Fresh Context Principle)
 * and parses its Y/N checklist JSON result.
 *
 * Key design decisions:
 * - Conservative fallback: evaluation failure → "pass" (evaluation is additive, not a gate)
 * - Fallback chain: 4-stage JSON parsing to handle varied LLM output formats
 * - Read-only evaluator: doc-evaluator only reads documents, never modifies them
 */

import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import { getPdcaStatus, savePdcaStatus } from "./status"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** doc-evaluator agent result */
export interface EvalResult {
  phase: "plan" | "design"
  document: string
  score: number
  threshold: number
  pass: boolean
  breakdown: Record<string, EvalCriterion>
  researchNeeded: boolean
  researchDirectives: ResearchDirective[]
}

export interface EvalCriterion {
  score: number
  max: number
  items: Record<string, EvalItem>
  gaps: string[]
}

export interface EvalItem {
  pass: "Y" | "N"
  points: number
  reason: string
}

export interface ResearchDirective {
  area: string          // breakdown key (e.g. "domainUnderstanding")
  action: string        // what to research
  targets: string[]     // file paths or search queries
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Conservative fallback: evaluation failure → pass (evaluation is additive) */
export const FALLBACK_RESULT: EvalResult = {
  phase: "plan",
  document: "",
  score: 80,
  threshold: 80,
  pass: true,
  breakdown: {},
  researchNeeded: false,
  researchDirectives: [],
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * Evaluate a PDCA plan or design document.
 *
 * 1. Resolves document path
 * 2. Spawns doc-evaluator agent in a separate session (via delegate-task)
 * 3. Parses the JSON result with fallback chain
 *
 * Returns null if the document does not exist.
 * Caller should use FALLBACK_RESULT when this returns null.
 */
export async function evaluateDocument(
  client: any, // PluginClient — typed as any to avoid circular import
  directory: string,
  feature: string,
  phase: "plan" | "design",
): Promise<EvalResult | null> {
  const docPath = phase === "plan"
    ? join(directory, "docs/01-plan/features", `${feature}.plan.md`)
    : join(directory, "docs/02-design/features", `${feature}.design.md`)

  if (!existsSync(docPath)) return null

  const prompt = buildEvaluatorPrompt(phase, docPath)

  // Spawn doc-evaluator via delegate-task (sync path)
  // agent_name: "doc-evaluator", run_in_background: false
  const resultText = await spawnEvaluator(client, directory, prompt)

  return parseEvaluationResult(resultText)
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

const PLAN_CHECKLIST = `## Plan Checklist (6 criteria, 15 items, 100pts)

### 1. Research Foundation (20pts)
- RF-01: Research document referenced (docs/00-research/{feature}-plan-research.md linked or cited) (10pts)
- RF-02: Research findings applied — decisions and scope informed by research evidence, not assumptions (10pts)

### 2. Domain Understanding (25pts)
- DU-01: Domain terminology defined (10pts)
- DU-02: Domain theory/principles explained (8pts)
- DU-03: Existing solutions analyzed with comparison (7pts)

### 3. Problem Definition (20pts)
- PD-01: Problem and value clearly stated (8pts)
- PD-02: Scope boundaries defined (7pts)
- PD-03: Target users/stakeholders identified (5pts)

### 4. Scope Clarity (15pts)
- SC-01: Functional requirements listed (6pts)
- SC-02: Acceptance criteria specified (5pts)
- SC-03: MVP vs full scope distinguished (4pts)

### 5. Risk Awareness (10pts)
- RA-01: Technical risks identified (5pts)
- RA-02: Mitigation strategies proposed (5pts)

### 6. Tech Direction (10pts)
- TD-01: Tech stack candidates compared with rationale (5pts)
- TD-02: References or evidence cited from research (5pts)`

const DESIGN_CHECKLIST = `## Design Checklist (6 criteria, 15 items, 100pts)

### 1. Research Foundation (15pts)
- RF-01: Research document referenced (docs/00-research/{feature}-design-research.md linked or cited) (8pts)
- RF-02: Design decisions backed by research — tech choices, patterns, and libraries justified with evidence from research (7pts)

### 2. Data Structure Design (20pts)
- DS-01: Core types/interfaces defined (8pts)
- DS-02: Field documentation present (7pts)
- DS-03: Relationships mapped (5pts)

### 3. Architecture Clarity (25pts)
- AC-01: Architecture diagram included (10pts)
- AC-02: Module scope defined (10pts)
- AC-03: Error handling strategy (5pts)

### 4. Data Flow (15pts)
- DF-01: Step-by-step flow documented (8pts)
- DF-02: I/O formats specified (7pts)

### 5. API/Interface Design (15pts)
- AI-01: Function/API signatures listed (10pts)
- AI-02: Call relationships mapped (5pts)

### 6. Tech Stack Detail (10pts)
- TS-01: Library versions specified with rationale from research (4pts)
- TS-02: Cost/performance analysis (3pts)
- TS-03: Build/deploy configuration (3pts)`

const JSON_SCHEMA_DESCRIPTION = `Return a JSON object matching this schema:
{
  "phase": "plan" | "design",
  "document": "<file path>",
  "score": <0-100>,
  "threshold": 80,
  "pass": true | false,
  "breakdown": {
    "<criterionName>": {
      "score": <number>,
      "max": <number>,
      "items": {
        "<itemName>": { "pass": "Y" | "N", "points": <number>, "reason": "<evidence>" }
      },
      "gaps": ["<gap description>"]
    }
  },
  "researchNeeded": true | false,
  "researchDirectives": [
    { "area": "<criterionName>", "action": "<what to research>", "targets": ["<search query>"] }
  ]
}`

function buildEvaluatorPrompt(
  phase: "plan" | "design",
  docPath: string,
): string {
  const checklist = phase === "plan"
    ? PLAN_CHECKLIST
    : DESIGN_CHECKLIST

  const researchPath = phase === "plan"
    ? docPath.replace(/01-plan\/features\/(.+)\.plan\.md/, "00-research/$1-plan-research.md")
    : docPath.replace(/02-design\/features\/(.+)\.design\.md/, "00-research/$1-design-research.md")

  return `You are evaluating a document you did NOT write. You have no knowledge of the author's intent. Judge ONLY what is written in the document, not what might have been intended.

Read the document at ${docPath} and apply the ${phase} checklist below.
Also check if a research document exists at ${researchPath} — if it exists, verify the ${phase} document references and applies its findings.
Return ONLY a JSON result inside a \`\`\`json code block. No other text before or after.

${checklist}

${JSON_SCHEMA_DESCRIPTION}

Rules:
- Only mark Y if the item is CLEARLY satisfied with evidence in the document. Do not infer or assume.
- If unsure, mark N.
- For Research Foundation (RF) criteria: mark Y only if the document explicitly references research results or cites evidence from the research document. Generic statements without research backing score N.
- For each Y/N item, cite the specific section or line that satisfies the criterion (or note its absence).
- For each criterion scoring below 50% of its max, add to researchDirectives with revision guidance.
- Set researchNeeded=true if score < threshold (80). Note: research was already performed prior to document creation, so directives should focus on revision using existing research in docs/00-research/.`
}

// ---------------------------------------------------------------------------
// Evaluator Spawn
// ---------------------------------------------------------------------------

/**
 * Spawn an inline evaluation subtask (no dedicated agent file needed).
 * Uses sync path (run_in_background: false) to get result inline.
 * Model: sonnet via subagent_type, temperature controlled by prompt instructions.
 */
async function spawnEvaluator(
  client: any,
  directory: string,
  prompt: string,
): Promise<string> {
  try {
    if (client?.callTool) {
      const result = await client.callTool("agent", {
        description: "Evaluate document quality",
        prompt,
        subagent_type: "general-purpose",
        model: "sonnet",
        run_in_background: false,
      })
      return typeof result === "string" ? result : result?.output ?? ""
    }
    return ""
  } catch (e: any) {
    // Evaluation spawn failure → caller uses FALLBACK_RESULT
    return ""
  }
}

// ---------------------------------------------------------------------------
// JSON Parsing (Fallback Chain)
// ---------------------------------------------------------------------------

/**
 * Parse evaluator output into EvalResult with a 4-stage fallback chain:
 * 1. Code fence extraction (```json ... ```)
 * 2. Pure JSON (starts with {)
 * 3. { ... } block extraction
 * 4. Regex partial recovery (score + pass fields)
 *
 * Returns null if all parsing attempts fail.
 */
export function parseEvaluationResult(text: string): EvalResult | null {
  if (!text) return null

  // Stage 1: Code fence extraction
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch { /* next */ }
  }

  // Stage 2: Pure JSON
  try {
    const trimmed = text.trim()
    if (trimmed.startsWith("{")) return JSON.parse(trimmed)
  } catch { /* next */ }

  // Stage 3: { ... } block extraction
  const jsonBlock = text.match(/\{[\s\S]*\}/)
  if (jsonBlock) {
    try { return JSON.parse(jsonBlock[0]) } catch { /* next */ }
  }

  // Stage 4: Regex partial recovery
  const scoreMatch = text.match(/"score"\s*:\s*(\d+)/)
  const passMatch = text.match(/"pass"\s*:\s*(true|false)/)
  if (scoreMatch) {
    const score = parseInt(scoreMatch[1])
    return {
      phase: "plan",
      document: "",
      score,
      threshold: 80,
      pass: passMatch ? passMatch[1] === "true" : score >= 80,
      breakdown: {},
      researchNeeded: score < 80,
      researchDirectives: [],
    }
  }

  // All stages failed
  return null
}

// ---------------------------------------------------------------------------
// Research Handler
// ---------------------------------------------------------------------------

/**
 * Create research files based on evaluator directives.
 * Ensures docs/00-research/ directory exists and returns paths for created files.
 *
 * Note: v1 creates placeholder files. Actual research content is filled
 * by the LLM using WebSearch/Explore in the calling context.
 */
export async function handleResearch(
  directory: string,
  feature: string,
  directives: ResearchDirective[],
): Promise<string[]> {
  const researchDir = join(directory, "docs/00-research")
  if (!existsSync(researchDir)) mkdirSync(researchDir, { recursive: true })

  const savedFiles: string[] = []

  for (const directive of directives) {
    const fileName = `${feature}-${directive.area}.md`
    const filePath = join(researchDir, fileName)
    savedFiles.push(filePath)
  }

  return savedFiles
}

// ---------------------------------------------------------------------------
// Score Persistence
// ---------------------------------------------------------------------------

/**
 * Save evaluation score to .pdca-status.json for display in `/pdca status`.
 */
export async function saveEvalScore(
  directory: string,
  feature: string,
  phase: "plan" | "design",
  score: number,
): Promise<void> {
  const status = await getPdcaStatus(directory)
  const feat = status.features[feature]
  if (!feat) return

  if (!feat.evalScores) feat.evalScores = {}
  feat.evalScores[phase] = score
  feat.lastUpdated = new Date().toISOString()

  await savePdcaStatus(directory, status)
}
