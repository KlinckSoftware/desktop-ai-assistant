import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

let runs: unknown[] = []
beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    pipeline: {
      runs: vi.fn(async () => runs),
      onUpdate: vi.fn(() => () => {}),
      onComplete: vi.fn(() => () => {}),
      cancel: vi.fn()
    }
  }
})
afterEach(cleanup)

import RunsPanel from './RunsPanel'

describe('RunsPanel', () => {
  it('shows the empty state with no runs', async () => {
    runs = []
    render(<RunsPanel />)
    expect(await screen.findByText(/No runs yet/i)).toBeTruthy()
  })

  it('lists a run and shows the selected run output', async () => {
    runs = [
      {
        id: 'r1',
        ts: Date.now(),
        input: 'x',
        dryRun: false,
        label: 'run one',
        status: 'done',
        steps: [],
        updates: [{ type: 'step', index: 0, name: 'Step A', text: 'did the thing', runId: 'r1' }]
      }
    ]
    render(<RunsPanel />)
    // label shows in both the list and the selected-run header
    expect((await screen.findAllByText('run one')).length).toBeGreaterThan(0)
    // first run auto-selected → its step output rendered
    expect(await screen.findByText('did the thing')).toBeTruthy()
  })
})
