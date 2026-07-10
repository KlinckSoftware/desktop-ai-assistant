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

// Third/fourth participants for N-way coverage — routed through the mocked
// keyed API providers list, same as 'claude'/'gemini' are built-ins.
const threeProviders = [
  { id: 'p1', name: 'P1', hasKey: true },
  { id: 'p2', name: 'P2', hasKey: true }
]

describe('IPCModerator', () => {
  let mod: IPCModerator

  beforeEach(() => {
    vi.clearAllMocks()
    complete.mockResolvedValue('turn text')
    mod = new IPCModerator(gemini, broker)
  })

  describe('round sequencing (2-way)', () => {
    it('alternates seat turns per round, then pauses for synthesis approval', async () => {
      const texts = ['A1', 'B1', 'A2', 'B2']
      let n = 0
      complete.mockImplementation(async () => texts[n++])

      await mod.runDebate('build a widget', ['claude', 'gemini'], undefined, 2)

      const turns = updates().filter((u) => u.type === 'turn')
      expect(turns.map((u) => [u.seat, u.round, u.text])).toEqual([
        [0, 0, 'A1'],
        [1, 0, 'B1'],
        [0, 1, 'A2'],
        [1, 1, 'B2']
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
      expect(a2Prompt).toContain('Gemini proposed')
      expect(a2Prompt).toContain('B1')
      expect(a2Prompt).toContain('Original task: build a widget')
    })

    it('routes bash blocks proposed in round 1 through the command broker, surfaced in round 2', async () => {
      complete
        .mockResolvedValueOnce('plan:\n```bash run\nls -la\n```') // seat 0, round 1
        .mockResolvedValueOnce('critique') // seat 1, round 1
        .mockResolvedValueOnce('revised') // seat 0, round 2
        .mockResolvedValueOnce('final critique') // seat 1, round 2

      await mod.runDebate('task', ['claude', 'gemini'], undefined, 2)

      expect(broker.propose).toHaveBeenCalledWith('ls -la', 'claude', 'debate')
      // Seat 1's round-2 critique prompt is built from seat 0's round-1 turn,
      // which now has the terminal output appended.
      const seat1Round2Prompt = complete.mock.calls[3][1]
      expect(seat1Round2Prompt).toContain('cmd-ok') // terminal output surfaced to the critic
    })

    it('reports an unavailable participant as a debate failure', async () => {
      await mod.runDebate('task', ['nope', 'gemini'], undefined, 1)
      const last = updates().at(-1)
      expect(last?.type).toBe('error')
      expect(last?.text).toContain('"nope" is not available')
      expect(complete).not.toHaveBeenCalled()
    })

    it('reports a participant error as a debate failure', async () => {
      complete.mockRejectedValue(new Error('model exploded'))
      await mod.runDebate('task', ['claude', 'gemini'], undefined, 1)
      expect(updates().at(-1)).toMatchObject({ type: 'error', text: 'Debate failed: model exploded' })
    })
  })

  describe('participant count validation', () => {
    it('rejects fewer than 2 participants', async () => {
      await mod.runDebate('task', ['claude'], undefined, 1)
      expect(updates().at(-1)).toMatchObject({ type: 'error' })
      expect(updates().at(-1)?.text).toContain('2-4 participants')
      expect(complete).not.toHaveBeenCalled()
    })

    it('rejects more than 4 participants', async () => {
      vi.mocked(listProviders).mockResolvedValue(threeProviders as never)
      await mod.runDebate('task', ['claude', 'gemini', 'api:p1', 'api:p2', 'claude'], undefined, 1)
      expect(updates().at(-1)).toMatchObject({ type: 'error' })
      expect(updates().at(-1)?.text).toContain('2-4 participants')
      expect(complete).not.toHaveBeenCalled()
    })

    it('accepts exactly 4 participants', async () => {
      vi.mocked(listProviders).mockResolvedValue(threeProviders as never)
      await mod.runDebate('task', ['claude', 'gemini', 'api:p1', 'api:p2'], undefined, 1)
      expect(updates().at(-1)?.type).toBe('await')
      expect(complete).toHaveBeenCalledTimes(4)
    })
  })

  describe('3-way round-robin order', () => {
    it('round 1: every participant proposes in seat order; round 2: each critiques the OTHER two', async () => {
      vi.mocked(listProviders).mockResolvedValue(threeProviders as never)
      const texts = ['P1a', 'P2a', 'P3a', 'P1b', 'P2b', 'P3b']
      let n = 0
      complete.mockImplementation(async () => texts[n++])

      await mod.runDebate('design a cache', ['claude', 'gemini', 'api:p1'], undefined, 2)

      const turns = updates().filter((u) => u.type === 'turn')
      // Speaking order: seat 0,1,2 each round — 6 turns total across 2 rounds.
      expect(turns.map((u) => [u.seat, u.round, u.name, u.text])).toEqual([
        [0, 0, 'Claude', 'P1a'],
        [1, 0, 'Gemini', 'P2a'],
        [2, 0, 'P1', 'P3a'],
        [0, 1, 'Claude', 'P1b'],
        [1, 1, 'Gemini', 'P2b'],
        [2, 1, 'P1', 'P3b']
      ])

      // Seat 0's round-2 critique prompt references the OTHER two seats' round-1
      // turns (Gemini + P1), not its own.
      const seat0Round2Prompt = complete.mock.calls[3][1]
      expect(seat0Round2Prompt).toContain('Gemini proposed')
      expect(seat0Round2Prompt).toContain('P2a')
      expect(seat0Round2Prompt).toContain('P1 proposed')
      expect(seat0Round2Prompt).toContain('P3a')
      expect(seat0Round2Prompt).not.toContain('Claude proposed')

      // Seat 2's round-2 critique references seats 0 and 1, in seat order.
      const seat2Round2Prompt = complete.mock.calls[5][1]
      expect(seat2Round2Prompt).toContain('Claude proposed')
      expect(seat2Round2Prompt).toContain('P1a')
      expect(seat2Round2Prompt).toContain('Gemini proposed')
      expect(seat2Round2Prompt).toContain('P2a')
    })
  })

  describe('cancel mid-round', () => {
    it('stops at the next seat boundary after cancel()', async () => {
      let n = 0
      complete.mockImplementation(async () => {
        n++
        if (n === 2) mod.cancel() // during seat 1's round-1 turn
        return `t${n}`
      })

      await mod.runDebate('task', ['claude', 'gemini'], undefined, 3)

      expect(complete).toHaveBeenCalledTimes(2) // round 2/3 never started
      expect(updates().at(-1)).toMatchObject({ type: 'error', text: 'Debate cancelled.' })
      expect(updates().some((u) => u.type === 'await')).toBe(false)
    })

    it('maps an AbortError from an in-flight completion to "cancelled"', async () => {
      const abort = new Error('aborted')
      abort.name = 'AbortError'
      complete.mockRejectedValue(abort)
      await mod.runDebate('task', ['claude', 'gemini'], undefined, 2)
      expect(updates().at(-1)).toMatchObject({ type: 'error', text: 'Debate cancelled.' })
    })
  })

  describe('synthesizer selection', () => {
    it('defaults the synthesizer to the first participant when unspecified', async () => {
      await mod.runDebate('task', ['claude', 'gemini'], undefined, 1)
      expect(updates().at(-1)).toMatchObject({ type: 'await' })
      expect(updates().at(-1)?.text).toContain('Claude')

      complete.mockResolvedValue('final')
      await mod.synthesize()
      expect(updates().find((u) => u.type === 'synthesis')).toMatchObject({ name: 'Claude' })
    })

    it('honors an explicit synthesizerId other than seat 1', async () => {
      await mod.runDebate('task', ['claude', 'gemini'], 'gemini', 1)
      expect(updates().at(-1)).toMatchObject({ type: 'await' })
      expect(updates().at(-1)?.text).toContain('Gemini')

      complete.mockResolvedValue('final by gemini')
      await mod.synthesize()
      const synth = updates().find((u) => u.type === 'synthesis')
      expect(synth).toMatchObject({ name: 'Gemini', text: 'final by gemini' })
      // Gemini is not Claude-kind, so it gets the "write up a plan" framing, not "implement".
      const synthCall = complete.mock.calls.at(-1)!
      expect(synthCall[1]).toContain('Write the final, agreed implementation as a concrete plan')
    })

    it('rejects a synthesizerId that is not among the chosen participants', async () => {
      await mod.runDebate('task', ['claude', 'gemini'], 'nope', 1)
      expect(updates().at(-1)).toMatchObject({ type: 'error' })
      expect(updates().at(-1)?.text).toContain('not among the debate participants')
      expect(complete).not.toHaveBeenCalled()
    })
  })

  describe('synthesis gating', () => {
    it('synthesize() is a no-op before any debate reached the await gate', async () => {
      await mod.synthesize()
      expect(complete).not.toHaveBeenCalled()
      expect(updates()).toEqual([])
    })

    it('runs synthesis once after approval, with the edit toolset, then clears', async () => {
      await mod.runDebate('task', ['claude', 'gemini'], undefined, 1)
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
      await mod.runDebate('task', ['claude', 'gemini'], undefined, 1)
      const before = complete.mock.calls.length

      mod.decline()
      expect(updates().at(-1)).toMatchObject({ type: 'synthesis' })
      expect(updates().at(-1)?.text).toContain('declined')
      expect(complete.mock.calls.length).toBe(before) // no model call

      await mod.synthesize() // declined → nothing pending
      expect(complete.mock.calls.length).toBe(before)
    })

    it('reports a synthesis failure without crashing', async () => {
      await mod.runDebate('task', ['claude', 'gemini'], undefined, 1)
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
