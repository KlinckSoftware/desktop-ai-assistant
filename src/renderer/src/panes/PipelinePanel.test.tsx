import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const run = vi.fn(async () => 'run-1')
beforeEach(() => {
  run.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    debate: {
      agents: vi.fn(async () => [
        { id: 'claude', name: 'Claude', kind: 'claude' },
        { id: 'api:openai', name: 'OpenAI', kind: 'api' }
      ])
    },
    gemini: { listModels: vi.fn(async () => ['gemini-2.5-pro', 'gemini-2.5-flash']) },
    pipeline: {
      runs: vi.fn(async () => []),
      run,
      cancel: vi.fn(),
      onUpdate: vi.fn(() => () => {})
    }
  }
})
afterEach(cleanup)

import PipelinePanel from './PipelinePanel'

describe('PipelinePanel', () => {
  it('loading a template populates its steps', async () => {
    render(<PipelinePanel />)
    fireEvent.change(screen.getByDisplayValue('Template ▾'), {
      target: { value: 'Plan → Implement → Review' }
    })
    expect(screen.getByDisplayValue(/implementation plan/i)).toBeTruthy()
    expect(screen.getByDisplayValue(/Implement this plan/i)).toBeTruthy()
    expect(screen.getByDisplayValue(/Review the changes/i)).toBeTruthy()
  })

  it('Run is gated until there is a step + starting input, then calls pipeline.run', async () => {
    render(<PipelinePanel />)
    // wait for participants to load (agent select populated)
    await waitFor(() => expect((window as unknown as { api: { debate: { agents: { mock: { calls: unknown[] } } } } }).api.debate.agents.mock.calls.length).toBeGreaterThan(0))

    fireEvent.change(screen.getByDisplayValue('Template ▾'), { target: { value: 'Implement → Docs' } })
    fireEvent.change(screen.getByPlaceholderText(/Starting input/i), { target: { value: 'build a thing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    await waitFor(() => expect(run).toHaveBeenCalledOnce())
    const [steps, input] = run.mock.calls[0] as unknown as [unknown[], string]
    expect(steps.length).toBe(2)
    expect(input).toBe('build a thing')
  })
})
