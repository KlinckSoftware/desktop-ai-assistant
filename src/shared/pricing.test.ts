import { describe, it, expect } from 'vitest'
import { costFor } from './pricing'

describe('costFor', () => {
  it('computes cost from per-1M rates', () => {
    // gpt-4o-mini: 0.15 in / 0.60 out per 1M
    const c = costFor('gpt-4o-mini', 1_000_000, 1_000_000)
    expect(c).toBeCloseTo(0.75, 6)
  })

  it('matches a dated/suffixed model id by substring', () => {
    expect(costFor('gpt-4o-mini-2024-07-18', 1_000_000, 0)).toBeCloseTo(0.15, 6)
  })

  it('prefers the longest matching key (specific beats generic)', () => {
    // "gpt-4o-mini" must win over "gpt-4o" for a mini id
    const mini = costFor('gpt-4o-mini', 0, 1_000_000)
    expect(mini).toBeCloseTo(0.6, 6) // mini out-rate, not gpt-4o's 10
  })

  it('returns null for unknown models', () => {
    expect(costFor('some-random-local-model', 1000, 1000)).toBeNull()
  })

  it('returns null when model is undefined', () => {
    expect(costFor(undefined, 1000, 1000)).toBeNull()
  })

  it('scales linearly with token counts', () => {
    const a = costFor('gpt-4o', 500, 500)
    const b = costFor('gpt-4o', 1000, 1000)
    expect(b! / a!).toBeCloseTo(2, 6)
  })
})
