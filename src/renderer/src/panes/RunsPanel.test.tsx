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

  // Ticket #17: step output containing a generated-image filename renders an
  // app-image:// thumbnail beneath the text (RunsPanel -> StepOutput).
  it('renders an app-image thumbnail when step output contains a generated-image filename', async () => {
    runs = [
      {
        id: 'r1',
        ts: Date.now(),
        input: 'go',
        dryRun: false,
        label: 'vision run',
        status: 'done',
        steps: [],
        updates: [
          { type: 'step', index: 0, name: 'Gemini', text: 'here is img_123_abc.png for review', runId: 'r1' }
        ]
      }
    ]
    render(<RunsPanel />)
    expect(await screen.findByText(/img_123_abc\.png/)).toBeTruthy()
    expect(document.querySelector('img[src="app-image://img_123_abc.png"]')).toBeTruthy()
  })

  it('renders no thumbnail when step output has no image ref', async () => {
    runs = [
      {
        id: 'r1',
        ts: Date.now(),
        input: 'go',
        dryRun: false,
        label: 'plain run',
        status: 'done',
        steps: [],
        updates: [{ type: 'step', index: 0, name: 'Gemini', text: 'just plain text, no images', runId: 'r1' }]
      }
    ]
    render(<RunsPanel />)
    expect(await screen.findByText(/just plain text/)).toBeTruthy()
    expect(document.querySelector('img[src^="app-image://"]')).toBeNull()
  })
})
