import { describe, it, expect } from 'vitest'
import { isDue, localHHMM } from './Scheduler'
import type { ScheduledJob } from '../../shared/types'

const base = (over: Partial<ScheduledJob>): ScheduledJob => ({
  id: 'j',
  name: 'job',
  steps: [{ agentId: 'claude' }],
  input: '',
  trigger: { kind: 'interval', minutes: 60 },
  enabled: true,
  ...over
})

const MIN = 60_000

describe('isDue — interval', () => {
  it('fires when the interval has elapsed', () => {
    const now = 10 * 60 * MIN
    expect(isDue(base({ trigger: { kind: 'interval', minutes: 60 }, lastRun: now - 61 * MIN }), now, '00:00')).toBe(true)
  })
  it('does not fire before the interval', () => {
    const now = 10 * 60 * MIN
    expect(isDue(base({ trigger: { kind: 'interval', minutes: 60 }, lastRun: now - 30 * MIN }), now, '00:00')).toBe(
      false
    )
  })
  it('fires on first run (no lastRun)', () => {
    expect(isDue(base({ trigger: { kind: 'interval', minutes: 5 } }), 9_999_999, '00:00')).toBe(true)
  })
})

describe('isDue — daily', () => {
  it('fires when the local time matches and it has not run this minute', () => {
    const now = 100 * MIN
    expect(isDue(base({ trigger: { kind: 'daily', time: '09:30' }, lastRun: 0 }), now, '09:30')).toBe(true)
  })
  it('does not fire at a different time', () => {
    expect(isDue(base({ trigger: { kind: 'daily', time: '09:30' } }), 100 * MIN, '09:31')).toBe(false)
  })
  it('does not double-fire within the same minute', () => {
    const now = 100 * MIN
    expect(isDue(base({ trigger: { kind: 'daily', time: '09:30' }, lastRun: now - 10_000 }), now, '09:30')).toBe(false)
  })
})

describe('isDue — disabled / git', () => {
  it('never fires a disabled job', () => {
    expect(isDue(base({ enabled: false, lastRun: 0 }), 9e12, '00:00')).toBe(false)
  })
  it('git triggers are event-driven, never due here', () => {
    expect(isDue(base({ trigger: { kind: 'git' } }), 9e12, '00:00')).toBe(false)
  })
})

describe('localHHMM', () => {
  it('zero-pads hours and minutes', () => {
    expect(localHHMM(new Date(2026, 0, 1, 9, 5))).toBe('09:05')
    expect(localHHMM(new Date(2026, 0, 1, 23, 59))).toBe('23:59')
  })
})
