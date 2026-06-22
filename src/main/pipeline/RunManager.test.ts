import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state', () => ({ appState: { send: vi.fn(), settings: { costCap: 0 } } }))

import { RunManager } from './RunManager'
import type { PipelineRunner } from './PipelineRunner'
import type { PipelineStep } from '../../shared/types'

const steps: PipelineStep[] = [{ agentId: 'claude' }]

// A runner whose run() we resolve manually, to drive the queue deterministically.
function makeRunner() {
  const calls: { resolve: () => void; emit: (u: { type: string; text?: string }) => void }[] = []
  const run = vi.fn((_s, _i, _d, emit: (u: { type: string }) => void) => {
    return new Promise<void>((resolve) => calls.push({ resolve, emit: emit as never }))
  })
  const cancel = vi.fn()
  return { runner: { run, cancel } as unknown as PipelineRunner, calls, run, cancel }
}

describe('RunManager', () => {
  let runner: ReturnType<typeof makeRunner>
  let mgr: RunManager
  beforeEach(() => {
    runner = makeRunner()
    mgr = new RunManager(runner.runner)
  })

  it('start() returns an id and marks the run queued→running', async () => {
    const id = mgr.start(steps, 'hello', false)
    expect(id).toBeTruthy()
    await Promise.resolve() // let pump() start
    const rec = mgr.list().find((r) => r.id === id)!
    expect(rec.status).toBe('running')
    expect(rec.label).toBe('hello')
  })

  it('serializes: a second run waits until the first finishes', async () => {
    const id1 = mgr.start(steps, 'one', false)
    const id2 = mgr.start(steps, 'two', false)
    await Promise.resolve()
    // Only the first run is executing.
    expect(runner.run).toHaveBeenCalledTimes(1)
    expect(mgr.list().find((r) => r.id === id2)!.status).toBe('queued')
    // Finish the first → the second starts.
    runner.calls[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(runner.run).toHaveBeenCalledTimes(2)
    expect(mgr.list().find((r) => r.id === id1)!.status).toBe('done')
  })

  it('cancel() drops a queued run without running it', async () => {
    mgr.start(steps, 'one', false)
    const id2 = mgr.start(steps, 'two', false)
    await Promise.resolve()
    mgr.cancel(id2)
    expect(mgr.list().find((r) => r.id === id2)!.status).toBe('cancelled')
    runner.calls[0].resolve()
    await Promise.resolve()
    await Promise.resolve()
    // The cancelled queued run never executed.
    expect(runner.run).toHaveBeenCalledTimes(1)
  })

  it('records step updates against the run', async () => {
    const id = mgr.start(steps, 'one', false)
    await Promise.resolve()
    runner.calls[0].emit({ type: 'step', text: 'did a thing' })
    const rec = mgr.list().find((r) => r.id === id)!
    expect(rec.updates.some((u) => u.type === 'step' && u.runId === id)).toBe(true)
  })
})
