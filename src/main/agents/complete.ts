import { appState } from '../state'
import type { DebateAgent, Message } from '../../shared/types'
import { claudeOneShot } from '../claude/ClaudeHeadless'
import { listProviders } from '../api/providers'
import { apiComplete } from '../api/OpenAIClient'
import type { GeminiClient, ImagePart } from '../gemini/GeminiClient'

// One-shot completion from any debate/pipeline participant. Shared by the
// debate moderator and the pipeline runner so both dispatch identically:
//   'claude'      -> headless `claude -p`
//   'gemini'      -> native Gemini one-shot (optionally vision, see `images`)
//   'api:<id>'    -> OpenAI-compatible provider one-shot
export async function completeParticipant(
  agent: DebateAgent,
  prompt: string,
  history: Message[],
  gemini: GeminiClient,
  signal?: AbortSignal,
  claudeTools?: string[],
  images: ImagePart[] = []
): Promise<string> {
  if (agent.kind === 'claude') {
    // Constrain Claude's tool set for debate (read-only during rounds, edit for
    // synthesis) so it can't freely edit/run while the API/Gemini participants
    // can't — keeps the participants homogeneous. undefined = unconstrained.
    return claudeOneShot(
      prompt,
      appState.projectRoot,
      appState.settings.claudeModel,
      appState.settings.claudeEffort,
      claudeTools,
      signal
    )
  }
  if (agent.kind === 'gemini') {
    return gemini.complete(prompt, history, signal, images)
  }
  const providerId = agent.id.slice('api:'.length)
  const provider = (await listProviders()).find((p) => p.id === providerId)
  return apiComplete(providerId, provider?.defaultModel ?? '', [...history, { role: 'user', content: prompt }], signal)
}
