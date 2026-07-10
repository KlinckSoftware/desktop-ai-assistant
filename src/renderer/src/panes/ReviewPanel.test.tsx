import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { WorktreePrResult } from '@shared/types'

const remove = vi.fn(async () => '')
const diff = vi.fn(async () => 'diff --git a/x b/x\n+hello')
const createPr = vi.fn(async (): Promise<WorktreePrResult> => ({ url: 'https://github.com/o/r/pull/1' }))
const openExternal = vi.fn()
let list: unknown[] = []
beforeEach(() => {
  remove.mockClear()
  diff.mockClear()
  createPr.mockClear()
  openExternal.mockClear()
  ;(window as unknown as { api: unknown }).api = {
    worktree: {
      list: vi.fn(async () => list),
      diff,
      remove,
      createPr,
      onChanged: vi.fn(() => () => {})
    },
    openExternal
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

  it('PR button pushes + opens a PR and shows the URL as a link', async () => {
    list = [{ sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'Claude 1' }]
    render(<ReviewPanel />)
    await screen.findByText('Claude 1')
    fireEvent.click(screen.getByRole('button', { name: 'PR' }))
    await waitFor(() => expect(createPr).toHaveBeenCalledWith('s1'))
    const link = await screen.findByText('https://github.com/o/r/pull/1')
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/1')
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/1')
  })

  it('PR button shows an inline error on failure', async () => {
    createPr.mockResolvedValueOnce({ error: 'no origin remote' })
    list = [{ sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'Claude 1' }]
    render(<ReviewPanel />)
    await screen.findByText('Claude 1')
    fireEvent.click(screen.getByRole('button', { name: 'PR' }))
    expect(await screen.findByText('no origin remote')).toBeTruthy()
  })
})
