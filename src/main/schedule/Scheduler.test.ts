import { describe, it, expect, vi } from 'vitest'
import { isDue, localHHMM, Scheduler } from './Scheduler'
import type { ScheduledJob } from '../../shared/types'
import type { RunManager } from '../pipeline/RunManager'
import type { JobStore } from './JobStore'
import type { FileSystemManager } from '../fs/FileSystemManager'

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

describe('git-trigger self-trigger guard', () => {
  it('does not re-fire a git job while its own run is active; fires once it completes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const gitJob: ScheduledJob = {
      id: 'j1',
      name: 'j',
      steps: [{ agentId: 'claude' }],
      input: '',
      trigger: { kind: 'git' },
      enabled: true
    }
    const status = { v: 'running' as ScheduledJob['trigger']['kind'] | string }
    const start = vi.fn(() => 'r1')
    const runManager = { start, get: () => ({ status: status.v }) } as unknown as RunManager
    let changeCb = (): void => {}
    const fsm = { onChange: (cb: () => void) => ((changeCb = cb), () => {}) } as unknown as FileSystemManager
    const store = { load: async () => [gitJob], list: () => [gitJob], flush: async () => {} } as unknown as JobStore

    const s = new Scheduler(runManager, store, fsm)
    await s.start()

    await s.fire(gitJob) // prime: start #1, jobRuns j1->r1, lastRun=0
    expect(start).toHaveBeenCalledTimes(1)

    vi.setSystemTime(70_000) // past the 60s git min-gap
    status.v = 'running' // its run is still active
    changeCb()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).toHaveBeenCalledTimes(1) // suppressed — active run

    status.v = 'done' // run finished
    changeCb()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).toHaveBeenCalledTimes(2) // now allowed

    s.stop()
    vi.useRealTimers()
  })
})
