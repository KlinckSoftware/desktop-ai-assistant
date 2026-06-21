import { appState } from '../state'
import { CH, type PipelineStep, type PipelineUpdate, type DebateAgent } from '../../shared/types'
import { completeParticipant } from '../agents/complete'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { IPCModerator } from '../moderator/IPCModerator'

// Runs a saved pipeline: the user's prompt flows through each step in order,
// each step's output becoming the next step's carried input. Stateless — the
// steps come from the renderer (where pipelines are stored/edited). Results
// stream to the renderer per step via CH.pipelineUpdate.
export class PipelineRunner {
  constructor(
    private gemini: GeminiClient,
    private moderator: IPCModerator
  ) {}

  async run(steps: PipelineStep[], input: string): Promise<void> {
    const send = (u: PipelineUpdate): void => appState.send(CH.pipelineUpdate, u)
    try {
      const available = await this.moderator.listDebateAgents()
      const byId = new Map<string, DebateAgent>(available.map((a) => [a.id, a]))

      let carry = input
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        const agent = byId.get(step.agentId)
        if (!agent) throw new Error(`step ${i + 1}: "${step.agentId}" is not available`)
        const prompt = step.instruction ? `${step.instruction}\n\n${carry}` : carry
        const text = await completeParticipant(agent, prompt, [], this.gemini)
        carry = text
        send({ type: 'step', index: i, agentId: agent.id, name: agent.name, text })
      }
      send({ type: 'done' })
    } catch (err) {
      send({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }
}
