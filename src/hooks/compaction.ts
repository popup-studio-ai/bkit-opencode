import type { PluginInput } from "@opencode-ai/plugin"
import { getPdcaStatus } from "../lib/pdca/status"
import { readAgentState } from "../lib/team/state-writer"
import { getRecentActivity } from "../lib/team/activity-log"
import { debugLog } from "../lib/core/debug"
import { getMemoryKeys } from "../lib/core/memory-store"
import { getAllSessionContext } from "../lib/context-hierarchy"
import { getActiveContext } from "../lib/task/context"
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"

const MAX_SNAPSHOTS = 10

export function createCompactionHandler(input: PluginInput) {
  return async (
    compInput: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => {
    try {
      const pdcaStatus = await getPdcaStatus(input.directory)
      const teamState = readAgentState(input.directory)

      const primaryFeature = pdcaStatus.primaryFeature
      const featureData = primaryFeature ? pdcaStatus.features?.[primaryFeature] : null

      // Gather session context and active context for preservation
      const sessionCtx = getAllSessionContext()
      const activeCtx = getActiveContext()
      const memoryKeys = getMemoryKeys()

      // FR-03.3: Enhanced activity summary with elapsed times and durations
      const activitySummary = (() => {
        const activity = getRecentActivity(input.directory, 10)
        if (activity.length === 0) return ""

        const running = activity.filter(a => a.status === "running")
        const completed = activity.filter(a => a.status !== "running")

        const parts: string[] = []
        if (running.length > 0) {
          parts.push(`Running: ${running.map(a => {
            const elapsed = Math.round((Date.now() - new Date(a.startedAt).getTime()) / 1000)
            return `${a.agentName}(${elapsed}s)`
          }).join(", ")}`)
        }
        if (completed.length > 0) {
          parts.push(`Recent: ${completed.slice(-5).map(a =>
            `${a.agentName}(${a.status},${a.durationSec ?? "?"}s)`
          ).join(", ")}`)
        }
        return parts.join(" | ")
      })()

      const snapshot = [
        `[bkit PDCA State Snapshot]`,
        `Feature: ${primaryFeature || "none"}`,
        `Phase: ${featureData?.phase || "none"}`,
        `Match Rate: ${featureData?.matchRate ?? "N/A"}`,
        `Iterations: ${featureData?.iterations ?? 0}`,
        `Team Active: ${teamState?.enabled ?? false}`,
        teamState?.enabled ? `Team Pattern: ${teamState.orchestrationPattern}` : "",
        teamState?.enabled ? `Teammates: ${teamState.teammates.map((t: any) => `${t.name}(${t.status})`).join(", ")}` : "",
        `Active Features: ${pdcaStatus.activeFeatures?.join(", ") || "none"}`,
        activeCtx.skill ? `Active Skill: ${activeCtx.skill}` : "",
        activeCtx.agent ? `Active Agent: ${activeCtx.agent}` : "",
        memoryKeys.length > 0 ? `Memory Keys: ${memoryKeys.join(", ")}` : "",
        sessionCtx.projectLevel ? `Project Level: ${sessionCtx.projectLevel}` : "",
        activitySummary,
      ].filter(Boolean).join("\n")

      output.context.push(snapshot)
      debugLog("Compaction", "PDCA snapshot preserved", { feature: primaryFeature, memoryKeys: memoryKeys.length })

      // FR-02.1: Persist snapshot to disk (CC parity — docs/.pdca-snapshots/)
      try {
        const snapshotDir = join(input.directory, "docs", ".pdca-snapshots")
        if (!existsSync(snapshotDir)) {
          mkdirSync(snapshotDir, { recursive: true })
        }

        const snapshotData = {
          timestamp: new Date().toISOString(),
          reason: "compaction",
          status: pdcaStatus,
          teamState: teamState?.enabled ? {
            feature: teamState.feature,
            phase: teamState.pdcaPhase,
            pattern: teamState.orchestrationPattern,
            teammates: teamState.teammates.map((t: any) => ({
              name: t.name, status: t.status,
            })),
          } : null,
          activity: getRecentActivity(input.directory, 10),
        }

        const snapshotPath = join(snapshotDir, `snapshot-${Date.now()}.json`)
        writeFileSync(snapshotPath, JSON.stringify(snapshotData, null, 2))

        // Cleanup: keep last MAX_SNAPSHOTS
        const files = readdirSync(snapshotDir)
          .filter(f => f.startsWith("snapshot-") && f.endsWith(".json"))
          .sort()
          .reverse()

        for (let i = MAX_SNAPSHOTS; i < files.length; i++) {
          try { unlinkSync(join(snapshotDir, files[i])) } catch {}
        }

        debugLog("Compaction", "Disk snapshot saved", { path: snapshotPath })
      } catch (e: any) {
        debugLog("Compaction", "Disk snapshot error (non-fatal)", { error: e?.message })
      }
    } catch (e: any) {
      debugLog("Compaction", "Handler error (non-fatal)", { error: e.message })
    }
  }
}
