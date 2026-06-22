import { describe, it, expect, beforeEach, vi } from 'vitest'

const claudeOneShot = vi.hoisted(() => vi.fn())
const apiComplete = vi.hoisted(() => vi.fn())
const listProviders = vi.hoisted(() => vi.fn())

vi.mock('../state', () => ({
  appState: { projectRoot: '/proj', settings: { claudeModel: 'cm', claudeEffort: 'high' } }
}))
vi.mock('../claude/ClaudeHeadless', () => ({ claudeOneShot }))
vi.mock('../api/OpenAIClient', () => ({ apiComplete }))
vi.mock('../api/providers', () => ({ listProviders }))

import { completeParticipant } from './complete'
import type { DebateAgent } from '../../shared/types'

const gemini = { complete: vi.fn() } as unknown as import('../gemini/GeminiClient').GeminiClient

beforeEach(() => {
  claudeOneShot.mockReset().mockResolvedValue('claude-out')
  apiComplete.mockReset().mockResolvedValue('api-out')
  listProviders.mockReset().mockResolvedValue([{ id: 'openai', defaultModel: 'gpt-4o-mini' }])
  ;(gemini.complete as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue('gemini-out')
})

describe('completeParticipant dispatch', () => {
  it("routes 'claude' to claudeOneShot with project root + model/effort", async () => {
    const a: DebateAgent = { id: 'claude', name: 'Claude', kind: 'claude' }
    const out = await completeParticipant(a, 'prompt', [], gemini)
    expect(out).toBe('claude-out')
    // trailing args: allowedTools (none for debate) + signal (none here)
    expect(claudeOneShot).toHaveBeenCalledWith('prompt', '/proj', 'cm', 'high', undefined, undefined)
  })

  it('forwards an AbortSignal to the participant', async () => {
    const a: DebateAgent = { id: 'claude', name: 'Claude', kind: 'claude' }
    const ctrl = new AbortController()
    await completeParticipant(a, 'prompt', [], gemini, ctrl.signal)
    expect(claudeOneShot).toHaveBeenCalledWith('prompt', '/proj', 'cm', 'high', undefined, ctrl.signal)
  })

  it('forwards a constrained Claude tool set (debate phase)', async () => {
    const a: DebateAgent = { id: 'claude', name: 'Claude', kind: 'claude' }
    await completeParticipant(a, 'p', [], gemini, undefined, ['Read', 'Grep', 'Glob', 'LS'])
    expect(claudeOneShot).toHaveBeenCalledWith('p', '/proj', 'cm', 'high', ['Read', 'Grep', 'Glob', 'LS'], undefined)
  })

  it("routes 'gemini' to gemini.complete with history", async () => {
    const a: DebateAgent = { id: 'gemini', name: 'Gemini', kind: 'gemini' }
    const hist = [{ role: 'user' as const, content: 'h' }]
    const out = await completeParticipant(a, 'p', hist, gemini)
    expect(out).toBe('gemini-out')
    expect(gemini.complete).toHaveBeenCalledWith('p', hist, undefined)
  })

  it("routes 'api:<id>' to apiComplete with the provider's default model and prompt appended", async () => {
    const a: DebateAgent = { id: 'api:openai', name: 'OpenAI', kind: 'api' }
    const out = await completeParticipant(a, 'p', [{ role: 'user', content: 'prior' }], gemini)
    expect(out).toBe('api-out')
    expect(apiComplete).toHaveBeenCalledWith(
      'openai',
      'gpt-4o-mini',
      [
        { role: 'user', content: 'prior' },
        { role: 'user', content: 'p' }
      ],
      undefined
    )
  })

  it('passes empty default model when the provider is unknown', async () => {
    listProviders.mockResolvedValue([])
    const a: DebateAgent = { id: 'api:ghost', name: 'Ghost', kind: 'api' }
    await completeParticipant(a, 'p', [], gemini)
    expect(apiComplete).toHaveBeenCalledWith('ghost', '', [{ role: 'user', content: 'p' }], undefined)
  })
})
