/**
 * bkit Task Board Tool (registered as "bkit-task-board")
 *
 * Shared task board for leader agents to create, list, update, and complete tasks.
 * Tasks are persisted to .bkit/shared-tasks.json (atomic writes).
 * On task completion, blocked tasks are automatically unblocked and notifications sent.
 */

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  getStoredTasks,
  createSingleTask,
  updateTask,
  completeTask,
  getTask,
  hydrateFromDisk,
  syncToDisk,
} from "../lib/team/task-queue"
import type { TeamTask } from "../lib/team/task-queue"
import { sendMessage } from "../lib/team/mailbox"

/**
 * When a task is completed, remove its ID from all other tasks' blockedBy arrays.
 * If any task becomes fully unblocked (blockedBy empty) and is still pending,
 * send a mailbox notification to cto-lead.
 */
function resolveBlockedTasks(completedTaskId: string, allTasks: TeamTask[], directory: string): string[] {
  const unblocked: string[] = []

  for (const task of allTasks) {
    if (!task.blockedBy || task.blockedBy.length === 0) continue

    const idx = task.blockedBy.indexOf(completedTaskId)
    if (idx === -1) continue

    task.blockedBy.splice(idx, 1)

    if (task.blockedBy.length === 0 && task.status === "pending") {
      unblocked.push(task.id)
      sendMessage(
        directory,
        "system",
        "cto-lead",
        `Task '${task.title}' (${task.id}) is now unblocked and ready for assignment.`,
      )
    }
  }

  return unblocked
}

export function createTaskBoardTool(input: PluginInput) {
  return tool({
    description:
      "Shared task board for creating, listing, updating, and completing team tasks. " +
      "Use 'list' to view all tasks, 'create' to add a new task, 'update' to change status/assignment, " +
      "'complete' to mark a task done (auto-unblocks dependent tasks).",
    args: {
      action: tool.schema
        .enum(["list", "create", "update", "complete"])
        .describe("Task board action"),
      title: tool.schema
        .string()
        .optional()
        .describe("Task title (required for create)"),
      description: tool.schema
        .string()
        .optional()
        .describe("Task description (optional for create)"),
      blockedBy: tool.schema
        .string()
        .optional()
        .describe("Comma-separated task IDs that block this task (optional for create)"),
      assignedTo: tool.schema
        .string()
        .optional()
        .describe("Agent name to assign the task to (optional for create/update)"),
      taskId: tool.schema
        .string()
        .optional()
        .describe("Task ID (required for update/complete)"),
      status: tool.schema
        .string()
        .optional()
        .describe("New status: pending, in_progress, completed, failed (optional for update)"),
      result: tool.schema
        .string()
        .optional()
        .describe("Result summary (optional for complete)"),
    },
    async execute(args, ctx) {
      const directory = ctx.directory
      hydrateFromDisk(directory)

      switch (args.action) {
        // -----------------------------------------------------------------
        // LIST
        // -----------------------------------------------------------------
        case "list": {
          const tasks = getStoredTasks(undefined, directory)
          if (tasks.length === 0) return "No tasks found. Use create to add tasks."

          // Optional filters via status/assignedTo args
          let filtered = tasks
          if (args.status) {
            filtered = filtered.filter(t => t.status === args.status)
          }
          if (args.assignedTo) {
            filtered = filtered.filter(t => t.assignedTo === args.assignedTo)
          }

          if (filtered.length === 0) return "No tasks match the filter."

          const lines = ["# Task Board", ""]
          lines.push("| ID | Title | Status | Assigned | Blocked By |")
          lines.push("|----|-------|--------|----------|------------|")

          for (const t of filtered) {
            const blocked = t.blockedBy.length > 0 ? t.blockedBy.join(", ") : "-"
            const assigned = t.assignedTo ?? "-"
            const shortId = t.id.length > 24 ? t.id.slice(0, 24) + "..." : t.id
            const shortTitle = t.title.length > 40 ? t.title.slice(0, 40) + "..." : t.title
            lines.push(`| ${shortId} | ${shortTitle} | ${t.status} | ${assigned} | ${blocked} |`)
          }

          const total = tasks.length
          const completed = tasks.filter(t => t.status === "completed").length
          const inProg = tasks.filter(t => t.status === "in_progress").length
          const pending = tasks.filter(t => t.status === "pending").length
          lines.push("")
          lines.push(`**Summary**: ${total} total | ${completed} completed | ${inProg} in-progress | ${pending} pending`)

          return lines.join("\n")
        }

        // -----------------------------------------------------------------
        // CREATE
        // -----------------------------------------------------------------
        case "create": {
          if (!args.title) return "Error: 'title' is required for create action."

          const blockedBy = args.blockedBy
            ? args.blockedBy.split(",").map(s => s.trim()).filter(Boolean)
            : []

          const task = createSingleTask(
            {
              title: args.title,
              description: args.description,
              blockedBy,
              assignedTo: args.assignedTo ?? null,
            },
            directory,
          )

          return [
            `Task created successfully.`,
            `- **ID**: ${task.id}`,
            `- **Title**: ${task.title}`,
            `- **Status**: ${task.status}`,
            `- **Assigned**: ${task.assignedTo ?? "unassigned"}`,
            task.blockedBy.length > 0 ? `- **Blocked by**: ${task.blockedBy.join(", ")}` : "",
          ].filter(Boolean).join("\n")
        }

        // -----------------------------------------------------------------
        // UPDATE
        // -----------------------------------------------------------------
        case "update": {
          if (!args.taskId) return "Error: 'taskId' is required for update action."

          const validStatuses = ["pending", "in_progress", "completed", "failed"]
          if (args.status && !validStatuses.includes(args.status)) {
            return `Error: Invalid status "${args.status}". Use: ${validStatuses.join(", ")}`
          }

          const updated = updateTask(
            args.taskId,
            {
              status: args.status as TeamTask["status"] | undefined,
              assignedTo: args.assignedTo !== undefined ? (args.assignedTo || null) : undefined,
            },
            directory,
          )

          if (!updated) return `Error: Task "${args.taskId}" not found.`

          return [
            `Task updated.`,
            `- **ID**: ${updated.id}`,
            `- **Title**: ${updated.title}`,
            `- **Status**: ${updated.status}`,
            `- **Assigned**: ${updated.assignedTo ?? "unassigned"}`,
          ].join("\n")
        }

        // -----------------------------------------------------------------
        // COMPLETE
        // -----------------------------------------------------------------
        case "complete": {
          if (!args.taskId) return "Error: 'taskId' is required for complete action."

          const task = getTask(args.taskId, directory)
          if (!task) return `Error: Task "${args.taskId}" not found.`
          if (task.status === "completed") return `Task "${args.taskId}" is already completed.`

          // Set result if provided
          if (args.result) {
            task.result = args.result
          }

          // Mark completed
          completeTask(args.taskId, directory)

          // Resolve blocked tasks
          const allTasks = getStoredTasks(undefined, directory)
          const unblockedIds = resolveBlockedTasks(args.taskId, allTasks, directory)

          // Persist blockedBy changes to disk (resolveBlockedTasks mutates in-memory refs)
          if (unblockedIds.length > 0) {
            syncToDisk(directory)
          }

          const lines = [
            `Task completed.`,
            `- **ID**: ${task.id}`,
            `- **Title**: ${task.title}`,
          ]
          if (args.result) {
            lines.push(`- **Result**: ${args.result}`)
          }
          if (unblockedIds.length > 0) {
            lines.push(`- **Unblocked**: ${unblockedIds.length} task(s) — notifications sent to cto-lead`)
          }

          return lines.join("\n")
        }

        default:
          return `Error: Unknown action "${args.action}". Use list, create, update, or complete.`
      }
    },
  })
}
