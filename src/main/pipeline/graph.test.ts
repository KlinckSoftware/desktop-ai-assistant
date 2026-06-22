import { describe, it, expect } from 'vitest'
import { normalize, topoOrder, resolvePrompt, conditionMet, combinedInput, mapItems } from './graph'
import type { PipelineStep } from '../../shared/types'

const S = (over: Partial<PipelineStep>): PipelineStep => ({ agentId: 'claude', ...over })

describe('normalize', () => {
  it('assigns s1.. ids and defaults deps to the previous step', () => {
    const n = normalize([S({}), S({}), S({})])
    expect(n.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(n.map((s) => s.deps)).toEqual([[], ['s1'], ['s2']])
  })
  it('preserves explicit ids and deps', () => {
    const n = normalize([S({ id: 'a' }), S({ id: 'b', deps: ['a'] }), S({ id: 'c', deps: ['a', 'b'] })])
    expect(n[2].deps).toEqual(['a', 'b'])
  })
})

describe('topoOrder', () => {
  it('orders a linear chain', () => {
    const order = topoOrder(normalize([S({}), S({}), S({})]))
    expect(order.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })
  it('orders a fan-in (diamond) so deps precede dependents', () => {
    const order = topoOrder(
      normalize([
        S({ id: 'root', deps: [] }),
        S({ id: 'a', deps: ['root'] }),
        S({ id: 'b', deps: ['root'] }),
        S({ id: 'join', deps: ['a', 'b'] })
      ])
    )
    const pos = (id: string): number => order.findIndex((s) => s.id === id)
    expect(pos('root')).toBeLessThan(pos('a'))
    expect(pos('a')).toBeLessThan(pos('join'))
    expect(pos('b')).toBeLessThan(pos('join'))
  })
  it('throws on an unknown dependency', () => {
    expect(() => topoOrder(normalize([S({ id: 'a', deps: ['ghost'] })]))).toThrow(/unknown step/)
  })
  it('throws on a cycle', () => {
    expect(() => topoOrder(normalize([S({ id: 'a', deps: ['b'] }), S({ id: 'b', deps: ['a'] })]))).toThrow(/cycle/)
  })
})

describe('resolvePrompt', () => {
  const outs = new Map([['s1', 'OUT1']])
  it('returns the run input for a depless step with no instruction', () => {
    expect(resolvePrompt(normalize([S({})])[0], new Map(), 'INPUT')).toBe('INPUT')
  })
  it('prepends instruction to dep text when no tokens are used', () => {
    const step = normalize([S({ id: 's1' }), S({ id: 's2', instruction: 'review', deps: ['s1'] })])[1]
    expect(resolvePrompt(step, outs, 'INPUT')).toBe('review\n\nOUT1')
  })
  it('interpolates ${id} and ${input} tokens verbatim', () => {
    const step = normalize([S({ id: 's2', instruction: 'use ${s1} and ${input}', deps: ['s1'] })])[0]
    expect(resolvePrompt(step, outs, 'INPUT')).toBe('use OUT1 and INPUT')
  })
})

describe('conditionMet', () => {
  const outs = new Map([['s1', 'tests FAILED here']])
  it('runs when there is no condition', () => {
    expect(conditionMet(normalize([S({})])[0], outs, 'x')).toBe(true)
  })
  it('runs only when the dep output contains the marker (case-insensitive)', () => {
    const step = normalize([S({ id: 's1' }), S({ id: 's2', deps: ['s1'], condition: { contains: 'failed' } })])[1]
    expect(conditionMet(step, outs, 'x')).toBe(true)
    expect(conditionMet({ ...step, condition: { contains: 'passed' } }, outs, 'x')).toBe(false)
  })
})

describe('combinedInput / mapItems', () => {
  it('joins multiple dep outputs', () => {
    const step = normalize([S({ id: 's3', deps: ['a', 'b'] })])[0]
    expect(combinedInput(step, new Map([['a', 'A'], ['b', 'B']]), 'x')).toBe('A\n\nB')
  })
  it('splits map input into non-empty trimmed lines', () => {
    expect(mapItems('  one \n\n two\nthree  \n')).toEqual(['one', 'two', 'three'])
  })
})
