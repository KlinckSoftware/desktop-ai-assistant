import { appState } from '../state'
import type { DebateAgent, Message } from '../../shared/types'
import { claudeOneShot } from '../claude/ClaudeHeadless'
import { listProviders } from '../api/providers'
import { apiComplete } from '../api/OpenAIClient'
import type { GeminiClient } from '../gemini/GeminiClient'

// One-shot completion from any debate/pipeline participant. Shared by the
// debate moderator and the pipeline runner so both dispatch identically:
//   'claude'      -> headless `claude -p`
//   'gemini'      -> native Gemini one-shot
//   'api:<id>'    -> OpenAI-compatible provider one-shot
export async function completeParticipant(
  agent: DebateAgent,
  prompt: string,
  history: Message[],
  gemini: GeminiClient
): Promise<string> {
  if (agent.kind === 'claude') {
    return claudeOneShot(prompt, appState.projectRoot, appState.settings.claudeModel, appState.settings.claudeEffort)
  }
  if (agent.kind === 'gemini') {
    return gemini.complete(prompt, history)
  }
  const providerId = agent.id.slice('api:'.length)
  const provider = (await listProviders()).find((p) => p.id === providerId)
  return apiComplete(providerId, provider?.defaultModel ?? '', [...history, { role: 'user', content: prompt }])
}
