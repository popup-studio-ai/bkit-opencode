import type { PluginInput } from "@opencode-ai/plugin"
import { updateFeaturePhase, updateFeatureMetrics, updateFeatureDocuments, getPdcaStatus, savePdcaStatus, applyPhaseToStatus, applyDocumentToStatus, applyMetricsToStatus, writeBkitMemory, readBkitMemory, initPdcaStatusIfNotExists } from "../lib/pdca/status"
import { getAgentConfig } from "../lib/agent-orchestrator"
import { getHierarchicalConfig } from "../lib/context-hierarchy"
import { autoAdvancePdcaPhase } from "../lib/pdca/automation"
import { debugLog } from "../lib/core/debug"
import { isSourceFile, isWorkFile, extractFeature } from "../lib/core/file"
import { getActiveContext, clearActiveContext } from "../lib/task/context"
import { getSkillConfig, getNextStepMessage } from "../lib/skill-orchestrator"
import { readAgentState, writeAgentState, updateTeammateStatus, addTeammate, addRecentMessage, updateAgentPhase } from "../lib/team/state-writer"
import { assignNextTeammateWork, handleTeammateIdle } from "../lib/team/coordinator"
import { blockedWritePaths } from "./tool-before"
import { autoCommitPhaseChange } from "../lib/core/auto-commit"
import { detectLevel } from "../lib/pdca/level"
import { unlinkSync, existsSync } from "fs"
import { join } from "path"

// PDCA skill action → phase mapping (matches Claude Code's pdca-skill-stop.js)
const PDCA_ACTION_PHASE_MAP: Record<string, string> = {
  research: "research",
  plan: "plan",
  design: "design",
  do: "do",
  analyze: "check",
  iterate: "act",
  report: "completed",
}

export function createToolAfterHandler(input: PluginInput) {
  return async (
    toolInput: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => {
    const tool = toolInput.tool.toLowerCase()

    try {
      // #2 fix: shared status across write/edit blocks to avoid redundant reads
      let cachedPdcaStatus: Awaited<ReturnType<typeof getPdcaStatus>> | null = null

      if (tool === "write" || tool === "edit") {
        const filePath = toolInput.args?.file_path || toolInput.args?.path || ""

        // H-2 cleanup: if this write was redirected to a temp file, delete it now
        if (blockedWritePaths.has(filePath)) {
          blockedWritePaths.delete(filePath)
          try { unlinkSync(filePath) } catch {}
          debugLog("ToolAfter", "Cleaned up blocked write temp file", { filePath })
          return // Nothing more to track for a blocked write
        }

        // Guard: skip PDCA tracking for files outside the project directory.
        // Prevents phantom features when editing external files (e.g. plugin code
        // in ~/.opencode/plugins/) that would pollute the project's pdca-status.json.
        const normalizedPath = filePath.startsWith("/") ? filePath : ""
        const normalizedDir = input.directory.endsWith("/") ? input.directory : input.directory + "/"
        if (normalizedPath && !normalizedPath.startsWith(normalizedDir)) {
          debugLog("ToolAfter", "Skipping PDCA tracking for external file", { filePath, directory: input.directory })
          return
        }

        // Extract feature from file path for smarter phase updates
        const detectedFeature = extractFeature(filePath)

        // Determine PDCA phase from file path
        let detectedPhase: string | null = null
        if (filePath.includes("00-research/")) {
          detectedPhase = "research"
        } else if (filePath.includes("01-plan/")) {
          detectedPhase = "plan"
        } else if (filePath.includes("02-design/")) {
          detectedPhase = "design"
        } else if (filePath.includes("03-analysis/")) {
          detectedPhase = "check"
        } else if (filePath.includes("04-report/")) {
          detectedPhase = "completed"
        } else if (isSourceFile(filePath)) {
          detectedPhase = "do"
        } else if (isWorkFile(filePath)) {
          detectedPhase = "do"
        }

        // --- Batched I/O: single read, apply all mutations, single write ---
        const status = await getPdcaStatus(input.directory)
        cachedPdcaStatus = status
        let statusDirty = false

        // B7 fix: Apply phase FIRST (creates feature if new), then track document path.
        // Previously document tracking ran before phase update, so for new features
        // applyDocumentToStatus() failed because the feature didn't exist yet.
        //
        // Phase regression protection: don't move phase backwards from file writes.
        // e.g., writing design-research doc (00-research/) during design phase
        // shouldn't regress phase from "plan" or "design" back to "research".
        // Document tracking still runs regardless (documents.research is updated).
        let skipPhaseUpdate = false
        let previousPhase: string | null = null
        if (detectedPhase && detectedFeature) {
          const currentFeature = status.features[detectedFeature]
          previousPhase = currentFeature?.phase ?? null
          if (currentFeature) {
            const phaseOrder = ["research", "plan", "design", "do", "check", "act", "completed"]
            const currentIdx = phaseOrder.indexOf(currentFeature.phase)
            const detectedIdx = phaseOrder.indexOf(detectedPhase)
            if (detectedIdx >= 0 && currentIdx >= 0 && detectedIdx < currentIdx) {
              skipPhaseUpdate = true
              debugLog("ToolAfter", `PDCA phase regression blocked: ${currentFeature.phase} → ${detectedPhase}`, { filePath, feature: detectedFeature })
            }
          }
        }

        if (detectedPhase && !skipPhaseUpdate) {
          const featureName = detectedFeature || undefined
          const resolved = applyPhaseToStatus(status, detectedPhase, featureName)
          if (resolved) {
            statusDirty = true
            debugLog("ToolAfter", `PDCA phase → ${detectedPhase}`, { filePath, feature: resolved })

            // Also update bkit-memory.json with current PDCA state
            const memory = readBkitMemory(input.directory) ?? {}
            memory.feature = resolved
            memory.phase = detectedPhase
            memory.lastUpdated = new Date().toISOString()
            if (!memory.startedAt) {
              memory.startedAt = new Date().toISOString()
            }
            writeBkitMemory(input.directory, memory)
            debugLog("ToolAfter", "bkit-memory updated", { feature: resolved, phase: detectedPhase })
          }
        } else if (detectedPhase && skipPhaseUpdate && detectedFeature) {
          // Phase regression blocked, but still ensure feature exists in status
          // (for brand new features that happen to write research docs first)
          if (!status.features[detectedFeature]) {
            applyPhaseToStatus(status, detectedPhase, detectedFeature)
            statusDirty = true
          }
        }

        // Track PDCA document paths (plan, design, analysis, report)
        // Runs after phase update so new features exist in status before doc tracking
        const docTypeMap: Record<string, "plan" | "design" | "analysis" | "report" | "research"> = {
          "00-research/": "research",
          "01-plan/": "plan",
          "02-design/": "design",
          "03-analysis/": "analysis",
          "04-report/": "report",
        }
        for (const [folder, docType] of Object.entries(docTypeMap)) {
          if (filePath.includes(folder) && detectedFeature) {
            // Journey docs are supplementary to the main design doc — don't overwrite documents.design
            if (folder === "02-design/" && filePath.includes("/journey/")) {
              break
            }
            const relativePath = filePath.startsWith(input.directory)
              ? filePath.slice(input.directory.length + 1)
              : filePath.replace(/^.*?(docs\/)/, "$1")
            if (applyDocumentToStatus(status, detectedFeature, docType, relativePath)) {
              statusDirty = true
              debugLog("ToolAfter", `PDCA doc tracked: ${docType}`, { feature: detectedFeature, relativePath })
            }
            break
          }
        }

        // Auto-evaluation trigger: when a plan/design document is written,
        // signal the LLM to spawn an evaluation sub-task.
        // This is code-guaranteed (fires regardless of which skill created the doc)
        // unlike the system-prompt instruction which can be missed.
        if (detectedFeature && (filePath.includes("01-plan/") || filePath.includes("02-design/")) && !filePath.includes("/journey/")) {
          const evalPhase = filePath.includes("01-plan/") ? "plan" : "design"
          output.metadata = output.metadata || {}
          output.metadata["bkit:evaluationNeeded"] = {
            phase: evalPhase,
            feature: detectedFeature,
            message: `${evalPhase} document created/updated. You MUST now spawn an evaluation sub-task (sync, sonnet) to assess quality. Use evaluateDocument() pattern: score >= 80 = PASS, < 80 = revision recommended (research already performed in docs/00-research/). Do NOT skip this step.`,
          }
          debugLog("ToolAfter", "Evaluation trigger set", { feature: detectedFeature, phase: evalPhase })
        }

        // Write pdca-status.json once for all mutations
        if (statusDirty) {
          // Ensure the file can be created (may not exist if initPdcaStatusIfNotExists
          // failed at session start for empty/new projects)
          try {
            await savePdcaStatus(input.directory, status)

            // Verify the file was actually created — if not, this is a critical issue
            const statusPath = join(input.directory, "docs", ".pdca-status.json")
            if (!existsSync(statusPath)) {
              process.stderr.write(`[bkit] CRITICAL: savePdcaStatus completed but file not found at ${statusPath}\n`)
              // Retry: force init then save again
              await initPdcaStatusIfNotExists(input.directory)
              await savePdcaStatus(input.directory, status)
            }
          } catch (e: any) {
            process.stderr.write(`[bkit] CRITICAL: Failed to save PDCA status: ${e?.message}\n`)
          }

          // Auto-commit when phase actually changed (backup path — primary is pdca-status tool)
          if (detectedPhase && detectedFeature && previousPhase !== detectedPhase) {
            autoCommitPhaseChange(input.directory, detectedPhase, detectedFeature, "pdca")
          }
        }

        // Auto-advance: use already-loaded status (no extra read)
        const feature = status?.primaryFeature
        const featureData = feature ? status?.features?.[feature] : null

        if (feature && featureData?.phase) {
          const advance = await autoAdvancePdcaPhase(
            feature,
            featureData.phase,
            { matchRate: featureData.matchRate },
            input.directory,
          )
          if (advance?.trigger) {
            debugLog("ToolAfter", "Auto-advance suggested", {
              feature,
              from: featureData.phase,
              to: advance.phase,
              trigger: advance.trigger,
            })
          }
        }
      }

      // FR-02: Handle Skill tool completions for PDCA phase tracking
      // (Equivalent of Claude Code's pdca-skill-stop.js)
      if (tool === "skill") {
        const skillName = toolInput.args?.skill || toolInput.args?.name || ""
        const skillArgs = toolInput.args?.args || ""

        // Detect PDCA skill invocations (bkit:pdca or pdca)
        if (skillName === "bkit:pdca" || skillName === "pdca") {
          const action = skillArgs.split(/\s+/)[0]?.toLowerCase()
          const featureWords = skillArgs.split(/\s+/).slice(1)
          const feature = featureWords.length > 0 ? featureWords.join("-") : undefined

          const mappedPhase = PDCA_ACTION_PHASE_MAP[action]
          if (mappedPhase) {
            try {
              await updateFeaturePhase(input.directory, mappedPhase, feature)
              debugLog("ToolAfter", `Skill PDCA phase → ${mappedPhase}`, {
                skill: skillName,
                action,
                feature,
              })

              // Also update bkit-memory.json
              const resolvedFeature = feature || (await getPdcaStatus(input.directory)).primaryFeature
              if (resolvedFeature) {
                const memory = readBkitMemory(input.directory) ?? {}
                memory.feature = resolvedFeature
                memory.phase = mappedPhase
                memory.lastUpdated = new Date().toISOString()
                writeBkitMemory(input.directory, memory)
              }
            } catch (e: any) {
              debugLog("ToolAfter", "Skill PDCA update error (non-fatal)", { error: e.message })
            }
          }
        }

        // task-template: attach auto-generated task metadata to output
        const cleanSkillName = skillName.replace(/^bkit:/, "")
        const skillConfig = getSkillConfig(cleanSkillName)

        if (skillConfig?.["task-template"]) {
          const template = skillConfig["task-template"]

          // Extract feature name from args (e.g. "plan user-auth" → feature="user-auth")
          const argWords = skillArgs.split(/\s+/).filter(Boolean)
          const featureFromArgs = argWords.slice(1).join("-") || ""

          // Fallback to primary feature from PDCA status
          const status = cachedPdcaStatus ?? await getPdcaStatus(input.directory)
          const taskFeature = featureFromArgs || status?.primaryFeature || "task"

          const taskSubject = template.replace(/\{feature\}/g, taskFeature)
          const pdcaPhase = skillConfig["pdca-phase"] || ""

          debugLog("ToolAfter", "Task created from skill task-template", {
            skill: cleanSkillName,
            subject: taskSubject,
            feature: taskFeature,
            pdcaPhase,
          })

          // Attach task info to output metadata for LLM to invoke TaskCreate
          output.metadata = output.metadata || {}
          output.metadata["bkit:skillTask"] = {
            subject: taskSubject,
            description: `PDCA ${pdcaPhase || "skill"} phase for ${taskFeature}`,
            activeForm: `${taskSubject} 진행 중`,
            pdcaPhase,
          }
        }
      }

      // FR-02: Parse agent results for PDCA metrics (matchRate, iterations)
      // (Equivalent of Claude Code's gap-detector-stop.js + iterator-stop.js)
      // B3 fix: Batched I/O — single read, in-memory mutations, single write.
      // Previously updateFeatureMetrics() and updateFeaturePhase() each did
      // independent read→write, causing lost updates under concurrent handlers.
      if (tool === "agent") {
        const resultText = output?.output || ""
        const agentName = (toolInput.args?.agent_name || toolInput.args?.name || "").toLowerCase()

        // Parse matchRate from gap-detector/code-analyzer output
        const matchRateMatch = resultText.match(/(?:Match Rate|matchRate|Match rate)[:\s]*(\d+)%?/i)
        let matchRate = matchRateMatch ? parseInt(matchRateMatch[1], 10) : null

        // Fallback: if output was truncated (e.g. by another plugin), read from pdca-status
        if (matchRate === null && (agentName.includes("gap-detector") || agentName.includes("code-analyzer"))) {
          try {
            const fallbackStatus = await getPdcaStatus(input.directory)
            const fallbackFeature = fallbackStatus.primaryFeature
            matchRate = fallbackFeature ? fallbackStatus.features[fallbackFeature]?.matchRate ?? null : null
            if (matchRate !== null) {
              debugLog("ToolAfter", "matchRate recovered from pdca-status fallback", { matchRate, agent: agentName })
            }
          } catch { /* non-fatal */ }
        }

        // Parse iteration count from pdca-iterator output
        const iterationMatch = resultText.match(/(?:Iteration|iteration)[:\s#]*(\d+)/i)
        const iterationCount = iterationMatch ? parseInt(iterationMatch[1], 10) : null

        if (matchRate !== null || iterationCount !== null) {
          try {
            const status = await getPdcaStatus(input.directory)
            const feature = status.primaryFeature
            if (feature && status.features[feature]) {
              let dirty = false

              // Apply metrics in-memory (no separate disk I/O)
              if (applyMetricsToStatus(status, feature, {
                matchRate: matchRate ?? undefined,
                iterations: iterationCount ?? undefined,
              })) {
                dirty = true
              }

              // Apply phase in-memory based on agent type
              if (agentName.includes("gap-detector") || agentName.includes("code-analyzer")) {
                if (applyPhaseToStatus(status, "check", feature)) dirty = true
              } else if (agentName.includes("pdca-iterator")) {
                if (applyPhaseToStatus(status, "act", feature)) dirty = true
              }

              // Single write for all mutations
              if (dirty) {
                await savePdcaStatus(input.directory, status)
              }

              // Also update bkit-memory
              const memory = readBkitMemory(input.directory) ?? {}
              if (matchRate !== null) memory.matchRate = matchRate
              if (iterationCount !== null) memory.iterationCount = iterationCount
              memory.lastUpdated = new Date().toISOString()
              writeBkitMemory(input.directory, memory)

              debugLog("ToolAfter", "Agent result parsed for PDCA metrics", {
                agent: agentName,
                matchRate,
                iterationCount,
                feature,
              })

              // FR-01.3: Score threshold — auto-iterate suggestion
              if (matchRate !== null && (agentName.includes("gap-detector") || agentName.includes("code-analyzer"))) {
                const agentCfg = getAgentConfig(agentName.includes("gap-detector") ? "gap-detector" : "code-analyzer")
                const threshold = agentCfg?.scoreThreshold
                  ?? (getHierarchicalConfig("pdca.matchThreshold", 90) as number)

                if (matchRate < threshold) {
                  output.metadata = output.metadata || {}
                  output.metadata["bkit:autoIterateSuggestion"] = {
                    matchRate,
                    threshold,
                    feature,
                    message: `Match rate ${matchRate}% < threshold ${threshold}%. Auto-iterate recommended with /pdca iterate ${feature}`,
                  }
                  debugLog("ToolAfter", "Auto-iterate suggestion", { matchRate, threshold, feature })
                }
              }
            }
          } catch (e: any) {
            debugLog("ToolAfter", "Agent result parsing error (non-fatal)", { error: e.message })
          }
        }
      }

      // FR-02.2: TaskCompleted auto-advance — detect PDCA phase from Task description
      // CC parity: pdca-task-completed.js detects [Plan], [Design], etc. in task subject
      if (tool === "agent") {
        const taskDesc = toolInput.args?.description || toolInput.args?.prompt?.slice(0, 100) || ""
        const PHASE_PATTERNS: Array<[RegExp, string]> = [
          [/\[Research\]/i, "plan"],
          [/\[Plan\]/i, "design"],
          [/\[Design\]/i, "do"],
          [/\[Do\]/i, "check"],
          [/\[Check\]/i, "act"],
          [/\[Act[^\]]*\]/i, "check"],
          [/\[Report\]/i, "completed"],
        ]

        for (const [pattern, nextPhase] of PHASE_PATTERNS) {
          if (pattern.test(taskDesc)) {
            try {
              const status = await getPdcaStatus(input.directory)
              const feature = status.primaryFeature
              if (feature && status.features[feature]) {
                const current = status.features[feature].phase
                const phaseOrder = ["research", "plan", "design", "do", "check", "act", "completed"]
                const currentIdx = phaseOrder.indexOf(current)
                const nextIdx = phaseOrder.indexOf(nextPhase)
                if (nextIdx > currentIdx) {
                  applyPhaseToStatus(status, nextPhase, feature)
                  await savePdcaStatus(input.directory, status)
                  debugLog("ToolAfter", "TaskCompleted auto-advance", {
                    feature, from: current, to: nextPhase, taskDesc: taskDesc.slice(0, 60),
                  })
                }
              }
            } catch (e: any) {
              debugLog("ToolAfter", "TaskCompleted auto-advance error (non-fatal)", { error: e?.message })
            }
            break
          }
        }
      }

      // SubagentStop detection: when agent tool completes, update teammate status.
      // B1 fix: Use agent_name (delegate-task's arg name), not subagent_type
      // B2 fix: Remove unreliable fallback — only mark completion on exact match
      // B5 fix: Skip if output indicates async dispatch (agent still running)
      // B4 fix: Single read + in-memory mutate + single write (was 3 READs + 1 WRITE)
      if (tool === "agent") {
        const agentState = readAgentState(input.directory)
        if (agentState?.enabled) {
          const subagentResultText = output?.output || ""
          const isAsyncDispatch = subagentResultText.includes("spawned in background")
          let stateChanged = false

          if (!isAsyncDispatch) {
            const agentNameArg = toolInput.args?.agent_name || toolInput.args?.subagent_type || toolInput.args?.agentType || ""
            const cleanName = agentNameArg.replace(/^bkit:/, "")

            const activeTeammate = cleanName
              ? agentState.teammates.find(
                  (t) =>
                    (t.name === cleanName || t.name === agentNameArg) &&
                    (t.status === "spawning" || t.status === "working"),
                )
              : undefined

            if (activeTeammate) {
              // B4: Mutate in-memory instead of calling updateTeammateStatus()
              activeTeammate.status = "completed"
              activeTeammate.currentTask = null
              activeTeammate.taskId = null
              activeTeammate.lastActivityAt = new Date().toISOString()
              stateChanged = true
              debugLog("ToolAfter", "SubagentStop - teammate completed", {
                teammate: activeTeammate.name,
                role: activeTeammate.role,
              })
            } else if (cleanName) {
              debugLog("ToolAfter", "SubagentStop - no exact match, skipping", {
                searchedFor: cleanName,
                activeTeammates: agentState.teammates
                  .filter(t => t.status === "spawning" || t.status === "working")
                  .map(t => t.name),
              })
            }
          } else {
            debugLog("ToolAfter", "SubagentStop - skipped (async dispatch)", {
              agent: toolInput.args?.agent_name,
            })
          }

          // B4: Write once after all mutations (no extra read needed)
          if (stateChanged) {
            writeAgentState(agentState, input.directory)
          }

          // B8 fix: Check completed teammates (not just idle) for pending work.
          // Previously only filtered for "idle" which was unreachable — agents
          // transition spawning→working→completed, never to "idle".
          const reassignableTeammates = agentState.teammates.filter(
            (t) => t.status === "idle" || t.status === "completed"
          )
          if (reassignableTeammates.length > 0) {
            const reassignStatus = await getPdcaStatus(input.directory)
            const reassignFeature = reassignStatus?.primaryFeature
            const reassignFeatureData = reassignFeature ? reassignStatus?.features?.[reassignFeature] : null
            for (const mate of reassignableTeammates) {
              const idleResult = handleTeammateIdle(mate.name, {
                feature: reassignFeature ?? "",
                phase: reassignFeatureData?.phase ?? "plan",
              }, input.directory)
              if (idleResult) {
                debugLog("ToolAfter", "TeammateReassign - work available", {
                  teammate: mate.name,
                  suggestion: idleResult.suggestion,
                })
              }
            }
          }
        }
      }

      // After Write/Edit to PDCA docs: trigger phase transition if team mode active
      // B4 fix: Batch all agent-state mutations into single read + write
      // (was N+2 READs + N+2 WRITEs from updateAgentPhase + addTeammate loop + addRecentMessage)
      const teamAgentState = (tool === "write" || tool === "edit") ? readAgentState(input.directory) : null
      if (teamAgentState?.enabled) {
        const filePath = toolInput.args?.file_path || toolInput.args?.path || ""
        const isPdcaDoc =
          filePath.includes("00-research/") ||
          filePath.includes("01-plan/") ||
          filePath.includes("02-design/") ||
          filePath.includes("03-analysis/") ||
          filePath.includes("04-report/")

        if (isPdcaDoc) {
          // #2 fix: reuse cached status from earlier write/edit block instead of re-reading
          const status = cachedPdcaStatus ?? await getPdcaStatus(input.directory)
          const feature = status?.primaryFeature
          const featureData = feature ? status?.features?.[feature] : null
          if (feature && featureData?.phase) {
            const result = assignNextTeammateWork(
              featureData.phase,
              feature,
              detectLevel(input.directory) ?? "Dynamic",
              input.directory,
            )
            if (result) {
              debugLog("ToolAfter", "Team phase transition triggered", {
                from: featureData.phase,
                to: result.nextPhase,
                feature,
                taskCount: result.tasks.length,
              })

              // B4 fix: All mutations on teamAgentState in-memory, single write at end
              try {
                // Update phase in-memory
                teamAgentState.pdcaPhase = result.nextPhase
                teamAgentState.lastUpdated = new Date().toISOString()

                // Register new teammates in-memory (was: addTeammate() loop with N reads+writes)
                if (result.team?.teammates) {
                  const now = new Date().toISOString()
                  for (const mate of result.team.teammates) {
                    const existing = teamAgentState.teammates.find(t => t.name === mate.name)
                    if (!existing && teamAgentState.teammates.length < 10) {
                      teamAgentState.teammates.push({
                        name: mate.name,
                        role: (mate as any).role ?? "agent",
                        model: "sonnet",
                        status: "spawning",
                        currentTask: (mate as any).task ?? null,
                        taskId: null,
                        sessionId: null,
                        startedAt: now,
                        lastActivityAt: now,
                      })
                    }
                  }
                }

                // Add phase transition message in-memory (was: addRecentMessage() with read+write)
                if (result.notice) {
                  teamAgentState.recentMessages.push({
                    from: "coordinator",
                    to: "all",
                    content: `Phase transition: ${featureData.phase} → ${result.nextPhase} (${result.tasks.length} tasks)`,
                    timestamp: new Date().toISOString(),
                  })
                  if (teamAgentState.recentMessages.length > 50) {
                    teamAgentState.recentMessages = teamAgentState.recentMessages.slice(-50)
                  }
                }

                // Single write for all team transition mutations
                writeAgentState(teamAgentState, input.directory)
              } catch (e: any) {
                debugLog("ToolAfter", "Team transition persist error (non-fatal)", { error: e.message })
              }
            }
          }
        }
      }

      // Skill orchestration: post-skill next-step guidance
      const ctx = getActiveContext()
      if (ctx.skill) {
        const skillConfig = getSkillConfig(ctx.skill)
        if (skillConfig?.["next-skill"]) {
          const nextMsg = getNextStepMessage(skillConfig["next-skill"])
          debugLog("ToolAfter", "Skill next-step", { skill: ctx.skill, nextSkill: skillConfig["next-skill"], message: nextMsg })
        }
        // Clear active context after tool completes
        clearActiveContext()
      }
    } catch (e: any) {
      debugLog("ToolAfter", "Handler error (non-fatal)", { error: e.message })
      // Log critical errors to stderr for visibility (debugLog requires BKIT_DEBUG=1)
      if (tool === "write" || tool === "edit") {
        try {
          process.stderr.write(`[bkit] tool-after error for ${tool}: ${e?.message}\n`)
        } catch {}
      }
    }
  }
}
