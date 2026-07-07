import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state', () => ({
  appState: { send: vi.fn(), settings: { debateRounds: 2 }, projectRoot: '' }
}))
vi.mock('../agents/registry', () => ({
  listAgents: vi.fn(async () => [{ id: 'claude', name: 'Claude', available: true }])
}))
vi.mock('../api/providers', () => ({
  listProviders: vi.fn(async () => [])
}))
vi.mock('../agents/complete', () => ({
  completeParticipant: vi.fn(async () => 'turn text')
}))

import { IPCModerator } from './IPCModerator'
import { completeParticipant } from '../agents/complete'
import { listProviders } from '../api/providers'
import { appState } from '../state'
import { CH, type DebateUpdate } from '../../shared/types'
import type { GeminiClient } from '../gemini/GeminiClient'
import type { CommandBroker } from '../executor/CommandBroker'

const gemini = { hasKey: vi.fn(async () => true) } as unknown as GeminiClient
const broker = { propose: vi.fn(async () => 'cmd-ok') } as unknown as CommandBroker

const updates = (): DebateUpdate[] =>
  vi
    .mocked(appState.send)
    .mock.calls.filter((c) => c[0] === CH.debateUpdate)
    .map((c) => c[1] as DebateUpdate)

const complete = vi.mocked(completeParticipant)

describe('IPCModerator', () => {
  let mod: IPCModerator

  beforeEach(() => {
    vi.clearAllMocks()
    complete.mockResolvedValue('turn text')
    mod = new IPCModerator(gemini, broker)
  })

  describe('round sequencing', () => {
    it('alternates a/b turns per round, then pauses for synthesis approval', async () => {
      const texts = ['A1', 'B1', 'A2', 'B2']
      let n = 0
      complete.mockImplementation(async () => texts[n++])

      await mod.runDebate('build a widget', 'claude', 'gemini', 2)

      const turns = updates().filter((u) => u.type === 'turn')
      expect(turns.map((u) => [u.side, u.round, u.text])).toEqual([
        ['a', 0, 'A1'],
        ['b', 0, 'B1'],
        ['a', 1, 'A2'],
        ['b', 1, 'B2']
      ])
      // Rounds complete → an 'await' gate, never an auto-synthesis.
      expect(updates().at(-1)?.type).toBe('await')
      expect(updates().some((u) => u.type === 'synthesis')).toBe(false)
      expect(complete).toHaveBeenCalledTimes(4)

      // Round turns use the read-only Claude toolset (analysis, no edits).
      for (const call of complete.mock.calls) {
        expect(call[5]).toEqual(['Read', 'Grep', 'Glob', 'LS'])
      }
      // Round 2 feeds B's prior critique back to A.
      const a2Prompt = complete.mock.calls[2][1]
      expect(a2Prompt).toContain('Gemini responded: "B1"')
      expect(a2Prompt).toContain('Original task: build a widget')
    })

    it('routes bash blocks proposed by A through the command broker into B prompt', async () => {
      complete
        .mockResolvedValueOnce('plan:\n```bash run\nls -la\n```')
        .mockResolvedValueOnce('critique')

      await mod.runDebate('task', 'claude', 'gemini', 1)

      expect(broker.propose).toHaveBeenCalledWith('ls -la', 'claude', 'debate')
      const bPrompt = complete.mock.calls[1][1]
      expect(bPrompt).toContain('cmd-ok') // terminal output surfaced to the critic
    })

    it('reports an unavailable participant as a debate failure', async () => {
      await mod.runDebate('task', 'nope', 'gemini', 1)
      const last = updates().at(-1)
      expect(last?.type).toBe('error')
      expect(last?.text).toContain('"nope" is not available')
      expect(complete).not.toHaveBeenCalled()
    })

    it('reports a participant error as a debate failure', async () => {
      complete.mockRejectedValue(new Error('model exploded'))
      await mod.runDebate('task', 'claude', 'gemini', 1)
      expect(updates().at(-1)).toMatchObject({ type: 'error', text: 'Debate failed: model exploded' })
    })
  })

  describe('cancel mid-round', () => {
    it('stops at the next round boundary after cancel()', async () => {
      let n = 0
      complete.mockImplementation(async () => {
        n++
        if (n === 2) mod.cancel() // during B's round-1 critique
        return `t${n}`
      })

      await mod.runDebate('task', 'claude', 'gemini', 3)

      expect(complete).toHaveBeenCalledTimes(2) // round 2/3 never started
      expect(updates().at(-1)).toMatchObject({ type: 'error', text: 'Debate cancelled.' })
      expect(updates().some((u) => u.type === 'await')).toBe(false)
    })

    it('maps an AbortError from an in-flight completion to "cancelled"', async () => {
      const abort = new Error('aborted')
      abort.name = 'AbortError'
      complete.mockRejectedValue(abort)
      await mod.runDebate('task', 'claude', 'gemini', 2)
      expect(updates().at(-1)).toMatchObject({ type: 'error', text: 'Debate cancelled.' })
    })
  })

  describe('synthesis gating', () => {
    it('synthesize() is a no-op before any debate reached the await gate', async () => {
      await mod.synthesize()
      expect(complete).not.toHaveBeenCalled()
      expect(updates()).toEqual([])
    })

    it('runs synthesis once after approval, with the edit toolset, then clears', async () => {
      await mod.runDebate('task', 'claude', 'gemini', 1)
      expect(updates().at(-1)?.type).toBe('await')

      complete.mockResolvedValue('final implementation')
      await mod.synthesize()

      const synth = updates().find((u) => u.type === 'synthesis')
      expect(synth?.text).toBe('final implementation')
      // Synthesis unlocks editing tools (rounds were read-only).
      const synthCall = complete.mock.calls.at(-1)!
      expect(synthCall[5]).toEqual(expect.arrayContaining(['Edit', 'Write', 'MultiEdit']))
      expect(synthCall[1]).toContain('Original task: task')

      // The pending transcript is consumed — a second approval does nothing.
      const calls = complete.mock.calls.length
      await mod.synthesize()
      expect(complete.mock.calls.length).toBe(calls)
    })

    it('decline() skips synthesis and clears the pending transcript', async () => {
      await mod.runDebate('task', 'claude', 'gemini', 1)
      const before = complete.mock.calls.length

      mod.decline()
      expect(updates().at(-1)).toMatchObject({ type: 'synthesis' })
      expect(updates().at(-1)?.text).toContain('declined')
      expect(complete.mock.calls.length).toBe(before) // no model call

      await mod.synthesize() // declined → nothing pending
      expect(complete.mock.calls.length).toBe(before)
    })

    it('reports a synthesis failure without crashing', async () => {
      await mod.runDebate('task', 'claude', 'gemini', 1)
      complete.mockRejectedValue(new Error('synth boom'))
      await mod.synthesize()
      expect(updates().at(-1)).toMatchObject({ type: 'error', text: 'Synthesis failed: synth boom' })
    })
  })

  describe('listDebateAgents', () => {
    it('lists claude, gemini and only keyed/no-key API providers', async () => {
      vi.mocked(listProviders).mockResolvedValue([
        { id: 'openai', name: 'OpenAI', hasKey: true },
        { id: 'ollama', name: 'Ollama', noKey: true },
        { id: 'groq', name: 'Groq' } // no key set → excluded
      ] as never)
      const agents = await mod.listDebateAgents()
      expect(agents.map((a) => a.id)).toEqual(['claude', 'gemini', 'api:openai', 'api:ollama'])
    })

    it('omits gemini when no key is configured', async () => {
      vi.mocked(listProviders).mockResolvedValue([] as never)
      vi.mocked(gemini.hasKey).mockResolvedValue(false as never)
      const agents = await mod.listDebateAgents()
      expect(agents.map((a) => a.id)).toEqual(['claude'])
    })
  })
})
