import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { WorktreePrResult, WorktreeStats } from '@shared/types'

const remove = vi.fn(async () => '')
const diff = vi.fn(async () => 'diff --git a/x b/x\n+hello')
const createPr = vi.fn(async (): Promise<WorktreePrResult> => ({ url: 'https://github.com/o/r/pull/1' }))
const stats = vi.fn(async (): Promise<WorktreeStats | null> => null)
const openExternal = vi.fn()
let list: unknown[] = []
let confirmSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  remove.mockClear()
  diff.mockClear()
  createPr.mockClear()
  stats.mockReset().mockResolvedValue(null)
  openExternal.mockClear()
  confirmSpy = vi.fn(() => true)
  window.confirm = confirmSpy as unknown as typeof window.confirm
  ;(window as unknown as { api: unknown }).api = {
    worktree: {
      list: vi.fn(async () => list),
      diff,
      remove,
      createPr,
      stats,
      onChanged: vi.fn(() => () => {})
    },
    openExternal
  }
})
afterEach(() => {
  cleanup()
})

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

  it('renders ahead/behind stats fetched lazily per worktree', async () => {
    list = [{ sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'Claude 1' }]
    stats.mockResolvedValue({ ahead: 4, behind: 2 })
    render(<ReviewPanel />)
    await screen.findByText('Claude 1')
    await waitFor(() => expect(stats).toHaveBeenCalledWith('s1'))
    expect(await screen.findByText('↑4')).toBeTruthy()
    expect(await screen.findByText('↓2')).toBeTruthy()
  })

  it('shows no stats when the stats call fails', async () => {
    list = [{ sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'Claude 1' }]
    stats.mockRejectedValue(new Error('boom'))
    render(<ReviewPanel />)
    await screen.findByText('Claude 1')
    await waitFor(() => expect(stats).toHaveBeenCalledWith('s1'))
    expect(screen.queryByText(/↑/)).toBeNull()
  })

  it('queue-merge calls remove in list order and stops on failure', async () => {
    list = [
      { sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'First' },
      { sessionId: 's2', path: '/wt/s2', branch: 'agent/s2', base: 'main', kind: 'agent', label: 'Second' },
      { sessionId: 's3', path: '/wt/s3', branch: 'agent/s3', base: 'main', kind: 'agent', label: 'Third' }
    ]
    remove.mockImplementation(async (...args: unknown[]) => {
      const sessionId = args[0] as string
      if (sessionId === 's2') return '[merge failed] conflict'
      return ''
    })
    render(<ReviewPanel />)
    await screen.findByText('First')
    await screen.findByText('Second')
    await screen.findByText('Third')

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(checkboxes[2])

    fireEvent.click(screen.getByRole('button', { name: /Merge selected/ }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('s2', 'merge'))
    // s3 must never be attempted — the queue stops after s2 fails.
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
    expect(remove).toHaveBeenNthCalledWith(1, 's1', 'merge')
    expect(remove).toHaveBeenNthCalledWith(2, 's2', 'merge')
    expect(remove).not.toHaveBeenCalledWith('s3', 'merge')

    expect(await screen.findByText(/Second.*\[merge failed\] conflict.*skipped/)).toBeTruthy()
  })
})
