// Team Communication Module
// Structured messaging for Agent Teams teammate communication.
// Ported from bkit-claude-code lib/team/communication.js to TypeScript for OpenCode.

import { debugLog } from "../core/debug"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const MESSAGE_TYPES = [
  "task_assignment",
  "review_request",
  "approval",
  "rejection",
  "phase_transition",
  "status_update",
  "directive",
  "info",
] as const

export type MessageType = (typeof MESSAGE_TYPES)[number]

export interface MessagePayload {
  subject: string
  body: string
  feature?: string | null
  phase?: string | null
  references?: string[]
}

export interface TeamMessage {
  from: string
  to: string
  type: MessageType
  payload: MessagePayload
  timestamp: string
}

// ---------------------------------------------------------------------------
// Message Factory
// ---------------------------------------------------------------------------

export function createMessage(
  fromRole: string,
  toRole: string,
  messageType: MessageType,
  payload: Partial<MessagePayload>,
): TeamMessage | null {
  if (!MESSAGE_TYPES.includes(messageType)) {
    debugLog("Communication", "Invalid message type", { messageType })
    return null
  }

  const message: TeamMessage = {
    from: fromRole,
    to: toRole,
    type: messageType,
    payload: {
      subject: payload.subject || "",
      body: payload.body || "",
      feature: payload.feature ?? null,
      phase: payload.phase ?? null,
      references: payload.references || [],
    },
    timestamp: new Date().toISOString(),
  }

  debugLog("Communication", "Message created", {
    from: fromRole,
    to: toRole,
    type: messageType,
  })

  return message
}

export function createBroadcast(
  fromRole: string,
  messageType: MessageType,
  payload: Partial<MessagePayload>,
): TeamMessage | null {
  const message = createMessage(fromRole, "all", messageType, payload)
  if (message) {
    debugLog("Communication", "Broadcast created", {
      from: fromRole,
      type: messageType,
    })
  }
  return message
}

// ---------------------------------------------------------------------------
// Specialized Messages
// ---------------------------------------------------------------------------

export function createPhaseTransitionNotice(
  feature: string,
  fromPhase: string,
  toPhase: string,
  context: { matchRate?: number; issues?: number } = {},
): TeamMessage | null {
  let body = `Feature "${feature}" is moving from ${fromPhase} to ${toPhase} phase.`
  if (context.matchRate != null) {
    body += ` Current match rate: ${context.matchRate}%.`
  }
  if (context.issues) {
    body += ` Open issues: ${context.issues}.`
  }

  return createBroadcast("cto", "phase_transition", {
    subject: `Phase Transition: ${fromPhase} → ${toPhase}`,
    body,
    feature,
    phase: toPhase,
  })
}

export function createPlanDecision(
  teammateRole: string,
  approved: boolean,
  feedback?: string,
): TeamMessage | null {
  const messageType: MessageType = approved ? "approval" : "rejection"
  return createMessage("cto", teammateRole, messageType, {
    subject: approved ? "Plan Approved" : "Plan Rejected",
    body:
      feedback ||
      (approved
        ? "Your plan has been approved. Proceed with execution."
        : "Please revise your plan based on the feedback."),
  })
}

export function createDirective(
  toRole: string,
  directive: string,
  context: { feature?: string; phase?: string; references?: string[] } = {},
): TeamMessage | null {
  return createMessage("cto", toRole, "directive", {
    subject: "CTO Directive",
    body: directive,
    feature: context.feature ?? null,
    phase: context.phase ?? null,
    references: context.references || [],
  })
}
