import { describe, it, expect, beforeEach, vi } from 'vitest'

// state.ts imports electron; stub it with a mutable settings object.
vi.mock('./state', () => ({ appState: { settings: { costCap: 0 } } }))

import { appState } from './state'
import { addUsageCost, capReached, sessionSpend, resetBudget } from './budget'

beforeEach(() => {
  resetBudget()
  appState.settings.costCap = 0
})

describe('budget', () => {
  it('accumulates estimated cost from usage (gpt-4o: $2.5/$10 per 1M)', () => {
    addUsageCost('gpt-4o', 1_000_000, 1_000_000)
    expect(sessionSpend()).toBeCloseTo(12.5, 5)
  })

  it('ignores unknown models (tokens-only, no price)', () => {
    addUsageCost('some-local-model', 1_000_000, 1_000_000)
    expect(sessionSpend()).toBe(0)
  })

  it('capReached is false when no cap is set', () => {
    addUsageCost('gpt-4o', 1_000_000, 1_000_000)
    expect(capReached()).toBe(false) // cap 0 = off
  })

  it('capReached flips once spend reaches the cap', () => {
    appState.settings.costCap = 10
    expect(capReached()).toBe(false)
    addUsageCost('gpt-4o', 1_000_000, 1_000_000) // $12.5 ≥ $10
    expect(capReached()).toBe(true)
  })
})
