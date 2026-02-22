// Agent Mailbox Module
// File-based inter-agent messaging with ring buffer (max 20 messages per agent).
// Storage: .bkit/mailbox/{agent-name}.json
// Uses atomic writes (tmp + rename) consistent with activity-log.ts pattern.

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync, readdirSync } from "fs"
import { join } from "path"
import { randomBytes } from "crypto"
import { debugLog } from "../core/debug"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MailboxMessage {
  id: string
  from: string
  to: string
  content: string
  timestamp: string
  read: boolean
}

interface AgentMailbox {
  version: "1.0"
  agent: string
  messages: MailboxMessage[]
}

export interface MailboxSummary {
  agent: string
  total: number
  unread: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGES = 20
const MAX_CONTENT_LENGTH = 500

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function getMailboxDir(directory: string): string {
  return join(directory, ".bkit", "mailbox")
}

function sanitizeAgentName(name: string): string {
  // Strip path traversal characters, keep only safe filename chars
  return name.replace(/[^a-zA-Z0-9\-_]/g, "").slice(0, 100) || "unknown"
}

function getMailboxPath(directory: string, agent: string): string {
  return join(getMailboxDir(directory), `${sanitizeAgentName(agent)}.json`)
}

function readMailbox(directory: string, agent: string): AgentMailbox {
  const filePath = getMailboxPath(directory, agent)
  try {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf8")
      const parsed = JSON.parse(content)
      if (parsed?.version === "1.0" && Array.isArray(parsed.messages)) {
        return parsed as AgentMailbox
      }
    }
  } catch (e: any) {
    debugLog("mailbox", `Failed to read mailbox for ${agent}`, { error: e?.message })
  }
  return { version: "1.0", agent, messages: [] }
}

function writeMailbox(mailbox: AgentMailbox, directory: string): void {
  const dir = getMailboxDir(directory)
  const filePath = getMailboxPath(directory, mailbox.agent)
  const tmpPath = filePath + ".tmp"

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(tmpPath, JSON.stringify(mailbox, null, 2))
    renameSync(tmpPath, filePath)
  } catch (e: any) {
    debugLog("mailbox", `Failed to write mailbox for ${mailbox.agent} (non-fatal)`, { error: e?.message })
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a message to an agent's mailbox.
 * Creates the mailbox file if it doesn't exist.
 * Applies ring buffer (max 20 messages).
 */
export function sendMessage(directory: string, from: string, to: string, content: string): void {
  const mailbox = readMailbox(directory, to)

  const message: MailboxMessage = {
    id: randomBytes(4).toString("hex"),
    from,
    to,
    content: content.slice(0, MAX_CONTENT_LENGTH),
    timestamp: new Date().toISOString(),
    read: false,
  }

  mailbox.messages.push(message)

  // Ring buffer: keep most recent MAX_MESSAGES
  if (mailbox.messages.length > MAX_MESSAGES) {
    mailbox.messages = mailbox.messages.slice(-MAX_MESSAGES)
  }

  writeMailbox(mailbox, directory)
  debugLog("mailbox", "Message sent", { from, to, id: message.id })
}

/**
 * Get all unread messages for an agent.
 */
export function getUnread(directory: string, agent: string): MailboxMessage[] {
  const mailbox = readMailbox(directory, agent)
  return mailbox.messages.filter(m => !m.read)
}

/**
 * Mark all messages as read for an agent.
 * Returns the number of messages marked.
 */
export function markAllRead(directory: string, agent: string): number {
  const mailbox = readMailbox(directory, agent)
  let count = 0

  for (const msg of mailbox.messages) {
    if (!msg.read) {
      msg.read = true
      count++
    }
  }

  if (count > 0) {
    writeMailbox(mailbox, directory)
    debugLog("mailbox", `Marked ${count} messages as read for ${agent}`)
  }

  return count
}

/**
 * List summary of all agent mailboxes.
 * Scans .bkit/mailbox/ directory for all .json files.
 */
export function listMailboxSummary(directory: string): MailboxSummary[] {
  const dir = getMailboxDir(directory)
  if (!existsSync(dir)) return []

  const summaries: MailboxSummary[] = []

  try {
    const files = readdirSync(dir).filter(f => f.endsWith(".json"))
    for (const file of files) {
      const agent = file.replace(".json", "")
      const mailbox = readMailbox(directory, agent)
      const unread = mailbox.messages.filter(m => !m.read).length
      summaries.push({
        agent,
        total: mailbox.messages.length,
        unread,
      })
    }
  } catch (e: any) {
    debugLog("mailbox", "Failed to list mailboxes (non-fatal)", { error: e?.message })
  }

  return summaries
}
