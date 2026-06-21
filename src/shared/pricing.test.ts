import { describe, it, expect, afterEach } from 'vitest'
import { costFor, setPriceOverrides } from './pricing'

afterEach(() => setPriceOverrides({})) // reset live overrides between tests

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

  it('prices Gemini models (matched by substring on dated ids)', () => {
    // gemini-2.5-flash: 0.30 in / 2.50 out
    expect(costFor('gemini-2.5-flash', 1_000_000, 0)).toBeCloseTo(0.3, 6)
    expect(costFor('models/gemini-2.5-flash-latest', 0, 1_000_000)).toBeCloseTo(2.5, 6)
  })

  it('prices Groq Llama and Mistral', () => {
    expect(costFor('llama-3.3-70b-versatile', 1_000_000, 0)).toBeCloseTo(0.59, 6)
    expect(costFor('mistral-large-latest', 0, 1_000_000)).toBeCloseTo(6, 6)
  })

  it('returns 0 for a zero-token request on a known model', () => {
    expect(costFor('gpt-4o', 0, 0)).toBe(0)
  })

  it('live overrides take precedence over the static table', () => {
    setPriceOverrides({ 'gpt-4o-mini': { in: 1, out: 2 } })
    // override: 1*1M in + 2*1M out per 1M = 3
    expect(costFor('gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(3, 6)
  })

  it('falls back to the static table for models absent from overrides', () => {
    setPriceOverrides({ 'some-other-model': { in: 9, out: 9 } })
    expect(costFor('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15, 6)
  })
})
