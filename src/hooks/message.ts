import type { PluginInput } from "@opencode-ai/plugin"
import { matchImplicitAgentTrigger, matchImplicitSkillTrigger, detectNewFeatureIntent } from "../lib/intent/trigger"
import { calculateAmbiguityScore, generateClarifyingQuestions } from "../lib/intent/ambiguity"
import { classifyTask, getPdcaLevel, getPdcaGuidance } from "../lib/task/classification"
import { suggestTeamMode } from "../lib/team/coordinator"
import { getPdcaStatus } from "../lib/pdca/status"
import { debugLog } from "../lib/core/debug"
import { detectLanguage } from "../lib/intent/language"
import { setActiveSkill, setActiveAgent, clearActiveContext } from "../lib/task/context"
import { getSkillConfig } from "../lib/skill-orchestrator"

/**
 * Chat message hook handler.
 *
 * OpenCode's chat.message hook signature:
 *   input: { sessionID, agent?, model?, messageID?, variant? }
 *   output: { message: UserMessage; parts: Part[] }
 *
 * IMPORTANT: Parts pushed to output.parts MUST include { id, sessionID, messageID }
 * because OpenCode validates parts with PartBase schema (message-v2.ts) before
 * saving to DB via Session.updatePart(). Missing these fields causes Zod errors.
 *
 * - id: unique part identifier (use crypto.randomUUID() or similar)
 * - sessionID: from output.message.sessionID
 * - messageID: from output.message.id
 */
export function createMessageHandler(input: PluginInput) {
  return async (
    msgInput: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; messageID?: string; variant?: string },
    output: { message: any; parts: any[] },
  ) => {
    // Extract user text from parts (TextPart: { type: "text", text: string })
    const userText = (output.parts || [])
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text as string)
      .join("\n")

    if (!userText || userText.length < 3) return

    try {
      // Clear previous skill context (allowed-tools, active skill) on new user message
      clearActiveContext()

      // Helper: create a properly formed TextPart with required PartBase fields.
      // synthetic: true → only sent to AI (audience: ["assistant"]), hidden from user's message bubble.
      // Without synthetic, bkit guidance text appears as part of the user's original message in TUI.
      const makeTextPart = (text: string) => ({
        id: crypto.randomUUID(),
        sessionID: output.message.sessionID ?? msgInput.sessionID,
        messageID: output.message.id ?? msgInput.messageID ?? "",
        type: "text" as const,
        text,
        synthetic: true,
      })

      // 0. Detect user language for multi-lang context
      const userLang = detectLanguage(userText)

      // 1. Agent trigger detection (8 languages)
      const agentMatch = matchImplicitAgentTrigger(userText)
      if (agentMatch && agentMatch.confidence > 0.3) {
        setActiveAgent(agentMatch.agent)
        output.parts.push(makeTextPart(
          `[bkit: Agent "${agentMatch.agent}" recommended for this task (confidence: ${Math.round(agentMatch.confidence * 100)}%). Use Task tool with subagent_type="${agentMatch.agent}".]`,
        ))
        debugLog("Message", "Agent trigger matched", { agent: agentMatch.agent, confidence: agentMatch.confidence, lang: userLang })
      }

      // 2. Skill trigger detection (with user-invocable filter)
      const skillMatch = matchImplicitSkillTrigger(userText)
      if (skillMatch) {
        const skillConfig = getSkillConfig(skillMatch.skill)
        if (skillConfig?.["user-invocable"] === false) {
          debugLog("Message", "Internal skill trigger suppressed", { skill: skillMatch.skill })
          // Internal-only skill: do not recommend to user
        } else {
          setActiveSkill(skillMatch.skill)
          output.parts.push(makeTextPart(
            `[bkit: Skill "${skillMatch.skill}" is relevant to this request.]`,
          ))
        }
      }

      // 3. New feature intent detection
      const featureIntent = detectNewFeatureIntent(userText)
      if (featureIntent) {
        output.parts.push(makeTextPart(
          `[bkit: New feature "${featureIntent.feature}" detected. Start PDCA workflow with bkit-pdca-status tool or bkit-team-start tool.]`,
        ))
      }

      // 4. Team mode suggestion
      const teamSuggestion = suggestTeamMode(userText, { directory: input.directory })
      if (teamSuggestion?.suggest) {
        output.parts.push(makeTextPart(
          `[bkit: Agent Team recommended - ${teamSuggestion.reason}. Use bkit-team-start tool.]`,
        ))
      }

      // 5. Ambiguity detection (for feature-level or larger requests)
      const classification = classifyTask(userText)
      if (classification === "feature" || classification === "major") {
        const pdcaStatus = await getPdcaStatus(input.directory)
        const currentPhase = pdcaStatus?.primaryFeature
          ? pdcaStatus.features?.[pdcaStatus.primaryFeature]?.phase
          : undefined
        const ambiguity = calculateAmbiguityScore(userText, { currentPhase })

        if (ambiguity.score >= 0.5) {
          const questions = generateClarifyingQuestions(userText, ambiguity.factors)
          if (questions.length > 0) {
            output.parts.push(makeTextPart(
              `[bkit: Request ambiguity ${Math.round(ambiguity.score * 100)}% (factors: ${ambiguity.factors.join(", ")}). Consider clarifying before proceeding.]`,
            ))
            debugLog("Message", "Ambiguity detected", { score: ambiguity.score, factors: ambiguity.factors })
          }
        }

        // 6. Task classification guidance
        const pdcaLevel = getPdcaLevel(classification)
        if (pdcaLevel === "standard" || pdcaLevel === "full") {
          const guidance = getPdcaGuidance(classification)
          output.parts.push(makeTextPart(
            `[bkit: ${guidance}]`,
          ))
        }
      }
    } catch (e: any) {
      debugLog("Message", "Handler error (non-fatal)", { error: e.message })
    }
  }
}
