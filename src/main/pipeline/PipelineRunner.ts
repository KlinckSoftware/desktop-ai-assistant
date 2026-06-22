import { appState } from '../state'
import { CH, type PipelineStep, type PipelineUpdate, type DebateAgent } from '../../shared/types'
import { completeParticipant } from '../agents/complete'
import { claudeOneShot } from '../claude/ClaudeHeadless'
import { apiCompleteAgentic } from '../api/OpenAIClient'
import { listProviders } from '../api/providers'
import { policyForStep, type PermissionMode } from '../policy/ApprovalPolicy'
import { worktreeManager } from '../worktree/WorktreeManager'
import {
  normalize,
  topoOrder,
  resolvePrompt,
  conditionMet,
  combinedInput,
  mapItems,
  type NormStep
} from './graph'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { IPCModerator } from '../moderator/IPCModerator'

let runSeq = 0

// Runs a saved pipeline: the user's prompt flows through each step in order,
// each step's output becoming the next step's carried input. Stateless — the
// steps come from the renderer (where pipelines are stored/edited). Results
// stream to the renderer per step via CH.pipelineUpdate.
// Map a step preset to Claude Code's own tool names for `--allowedTools`. A
// dry-run is approximated as read-only (Claude has no true dry-run). 'full'
// adds Bash (still gated by Claude's own permission checks).
export function claudeAllowedTools(mode: PermissionMode, dryRun: boolean): string[] {
  const READ = ['Read', 'Grep', 'Glob', 'LS']
  if (dryRun || mode === 'read-only') return READ
  const EDIT = [...READ, 'Edit', 'Write', 'MultiEdit']
  if (mode === 'edit') return EDIT
  return [...EDIT, 'Bash']
}

export class PipelineRunner {
  private cancelled = false
  private controller: AbortController | null = null

  constructor(
    private gemini: GeminiClient,
    private moderator: IPCModerator
  ) {}

  /** Request cancellation: aborts the in-flight step's model call AND stops at
   *  the next step boundary. */
  cancel(): void {
    this.cancelled = true
    this.controller?.abort()
  }

  // `emit` is the update sink (RunManager tags each update with its runId and
  // broadcasts/stores it). `runId` (when given) is used as the worktree/session
  // key so a run's branch is named after it.
  async run(
    steps: PipelineStep[],
    input: string,
    dryRun = false,
    emit: (u: PipelineUpdate) => void = (u) => appState.send(CH.pipelineUpdate, u),
    runIdArg?: string
  ): Promise<void> {
    const send = emit
    this.cancelled = false
    this.controller = new AbortController()
    const signal = this.controller.signal

    // The whole run shares ONE worktree/branch (pipeline/<runId>): every step and
    // any orchestrator-spawned subagent commits there, so the run produces a single
    // reviewable diff. Dry-runs execute nothing, so they need no worktree. Falls
    // back to the project root when isolation is off or the project isn't a repo.
    // One canonical session key for the whole run — used as the WorktreeManager
    // key, the appState session-root key, and the execTool sessionId, so all three
    // agree (and worktreeRemove can clear the right root).
    const runId = runIdArg || `run-${++runSeq}`
    let workRoot = appState.projectRoot
    if (!dryRun && appState.settings.isolateAgents) {
      const wt = await worktreeManager.create(appState.projectRoot, runId, 'pipeline').catch(() => null)
      if (wt) {
        workRoot = wt.path
        appState.setSessionRoot(runId, wt.path)
        worktreeManager.setLabel(runId, `pipeline (${steps.length} steps)`)
        appState.send(CH.worktreeChanged)
      }
    }

    try {
      const available = await this.moderator.listDebateAgents()
      const byId = new Map<string, DebateAgent>(available.map((a) => [a.id, a]))
      const providers = await listProviders()

      // Build the dependency graph and run steps in topological order. Each step's
      // output is keyed by id so later steps can fan in from several predecessors;
      // execution stays sequential so the one shared worktree is never co-written.
      const normed = normalize(steps)
      const ordered = topoOrder(normed) // throws on cycle / unknown dep
      const indexById = new Map(normed.map((s, i) => [s.id, i]))
      const outputs = new Map<string, string>()
      const ctx = { signal, dryRun, runId, workRoot, providers }

      for (const step of ordered) {
        if (this.cancelled) {
          send({ type: 'error', text: 'Cancelled.' })
          return
        }
        const agent = byId.get(step.agentId)
        if (!agent) throw new Error(`step "${step.id}": "${step.agentId}" is not available`)
        const i = indexById.get(step.id) ?? 0

        // Conditional steps skip (and pass empty output downstream) when unmet.
        if (!conditionMet(step, outputs, input)) {
          outputs.set(step.id, '')
          send({ type: 'step', index: i, agentId: agent.id, name: agent.name, text: '[skipped — condition not met]' })
          continue
        }

        let text: string
        if (step.map) {
          // Fan out: run the instruction once per non-empty input line, sequentially.
          const items = mapItems(combinedInput(step, outputs, input))
          const parts: string[] = []
          for (let k = 0; k < items.length && !this.cancelled; k++) {
            const itemPrompt = step.instruction ? `${step.instruction}\n\n${items[k]}` : items[k]
            const out = await this.runOne(step, agent, itemPrompt, ctx)
            parts.push(`— [${k + 1}/${items.length}] ${items[k].slice(0, 60)}\n${out}`)
          }
          text = parts.join('\n\n') || '[map: no input items]'
        } else {
          text = await this.runOne(step, agent, resolvePrompt(step, outputs, input), ctx)
        }
        outputs.set(step.id, text)
        send({ type: 'step', index: i, agentId: agent.id, name: agent.name, text })
      }
      send({ type: 'done' })
    } catch (err) {
      if (this.cancelled || (err instanceof Error && err.name === 'AbortError')) {
        send({ type: 'error', text: 'Cancelled.' })
        return
      }
      send({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  // Execute a single step (or one map item) and return its text output. API steps
  // run the gated agentic loop scoped to the run worktree; Claude runs `-p` in the
  // worktree with a tool set bounded by the step's permission; Gemini is one-shot.
  private async runOne(
    step: NormStep,
    agent: DebateAgent,
    prompt: string,
    ctx: {
      signal: AbortSignal
      dryRun: boolean
      runId: string
      workRoot: string
      providers: Awaited<ReturnType<typeof listProviders>>
    }
  ): Promise<string> {
    if (agent.kind === 'api') {
      const providerId = agent.id.slice('api:'.length)
      const model = step.model || ctx.providers.find((p) => p.id === providerId)?.defaultModel || ''
      const policy = policyForStep(step.permission ?? 'read-only', ctx.dryRun)
      return apiCompleteAgentic(providerId, model, [{ role: 'user', content: prompt }], policy, ctx.runId, ctx.signal)
    }
    if (agent.kind === 'claude') {
      return claudeOneShot(
        prompt,
        ctx.workRoot,
        step.model || appState.settings.claudeModel,
        step.effort || appState.settings.claudeEffort,
        claudeAllowedTools(step.permission ?? 'read-only', ctx.dryRun),
        ctx.signal
      )
    }
    return completeParticipant(agent, prompt, [], this.gemini, ctx.signal)
  }
}
