import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const remove = vi.fn(async () => '')
const diff = vi.fn(async () => 'diff --git a/x b/x\n+hello')
let list: unknown[] = []
beforeEach(() => {
  remove.mockClear()
  diff.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    worktree: {
      list: vi.fn(async () => list),
      diff,
      remove,
      onChanged: vi.fn(() => () => {})
    }
  }
})
afterEach(cleanup)

import ReviewPanel from './ReviewPanel'

describe('ReviewPanel', () => {
  it('shows the empty state when there are no worktrees', async () => {
    list = []
    render(<ReviewPanel />)
    expect(await screen.findByText(/No isolated work yet/i)).toBeTruthy()
  })

  it('lists a worktree, loads its diff, and Merge calls remove(merge)', async () => {
    list = [{ sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'Claude 1' }]
    render(<ReviewPanel />)
    expect(await screen.findByText('Claude 1')).toBeTruthy()
    // first worktree auto-selected → diff fetched
    await waitFor(() => expect(diff).toHaveBeenCalledWith('s1'))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('s1', 'merge'))
  })
})
