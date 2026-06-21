import { appState } from '../state'
import { CH, type PipelineStep, type PipelineUpdate, type DebateAgent } from '../../shared/types'
import { completeParticipant } from '../agents/complete'
import { claudeOneShot } from '../claude/ClaudeHeadless'
import { apiCompleteAgentic } from '../api/OpenAIClient'
import { listProviders } from '../api/providers'
import { policyForStep, type PermissionMode } from '../policy/ApprovalPolicy'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { IPCModerator } from '../moderator/IPCModerator'

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
  constructor(
    private gemini: GeminiClient,
    private moderator: IPCModerator
  ) {}

  async run(steps: PipelineStep[], input: string, dryRun = false): Promise<void> {
    const send = (u: PipelineUpdate): void => appState.send(CH.pipelineUpdate, u)
    try {
      const available = await this.moderator.listDebateAgents()
      const byId = new Map<string, DebateAgent>(available.map((a) => [a.id, a]))
      const providers = await listProviders()

      let carry = input
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        const agent = byId.get(step.agentId)
        if (!agent) throw new Error(`step ${i + 1}: "${step.agentId}" is not available`)
        const prompt = step.instruction ? `${step.instruction}\n\n${carry}` : carry

        let text: string
        if (agent.kind === 'api') {
          // API steps run the gated agentic loop → real (policy-bounded) file work.
          const providerId = agent.id.slice('api:'.length)
          const model = step.model || providers.find((p) => p.id === providerId)?.defaultModel || ''
          const policy = policyForStep(step.permission ?? 'read-only', dryRun)
          text = await apiCompleteAgentic(providerId, model, [{ role: 'user', content: prompt }], policy)
        } else if (agent.kind === 'claude') {
          // Claude runs its own tooling; constrain the tool SET to the step's
          // preset via --allowedTools so a pipeline step can't exceed its grant.
          // Per-step model/effort override the global Claude defaults.
          text = await claudeOneShot(
            prompt,
            appState.projectRoot,
            step.model || appState.settings.claudeModel,
            step.effort || appState.settings.claudeEffort,
            claudeAllowedTools(step.permission ?? 'read-only', dryRun)
          )
        } else {
          // Gemini-native step: one-shot text (no app-gated tools).
          text = await completeParticipant(agent, prompt, [], this.gemini)
        }
        carry = text
        send({ type: 'step', index: i, agentId: agent.id, name: agent.name, text })
      }
      send({ type: 'done' })
    } catch (err) {
      send({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }
}
