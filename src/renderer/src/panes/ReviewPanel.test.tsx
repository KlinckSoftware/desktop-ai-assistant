import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { WorktreePrResult, WorktreeStats } from '@shared/types'

const remove = vi.fn(async () => '')
const diff = vi.fn(async () => 'diff --git a/x b/x\n+hello')
const createPr = vi.fn(async (): Promise<WorktreePrResult> => ({ url: 'https://github.com/o/r/pull/1' }))
const stats = vi.fn(async (): Promise<WorktreeStats | null> => null)
const applyHunks = vi.fn(async (_sessionId: string, _patch: string) => '')
const openExternal = vi.fn()
let list: unknown[] = []
let confirmSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  remove.mockClear()
  diff.mockClear()
  createPr.mockClear()
  stats.mockReset().mockResolvedValue(null)
  applyHunks.mockClear().mockResolvedValue('')
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
      applyHunks,
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

  it('Select hunks toggles to a per-hunk checkbox picker and Apply calls the bridge', async () => {
    diff.mockResolvedValue(
      [
        'diff --git a/f.txt b/f.txt',
        'index 1111111..2222222 100644',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,3 +1,4 @@',
        ' line1',
        '+added-top',
        ' line2',
        ' line3',
        '@@ -20,3 +21,4 @@',
        ' line20',
        '+added-bottom',
        ' line21',
        ' line22',
        ''
      ].join('\n')
    )
    list = [{ sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'Claude 1' }]
    render(<ReviewPanel />)
    await screen.findByText('Claude 1')
    await waitFor(() => expect(diff).toHaveBeenCalledWith('s1'))

    fireEvent.click(screen.getByRole('button', { name: 'Select hunks' }))

    // Both hunk headers show, all checked by default.
    expect(await screen.findByText('@@ -1,3 +1,4 @@')).toBeTruthy()
    expect(await screen.findByText('@@ -20,3 +21,4 @@')).toBeTruthy()
    expect(await screen.findByText(/2 \/ 2 hunk\(s\) selected/)).toBeTruthy()

    // Uncheck the second hunk (identified by its own @@ header, not by index —
    // the left pane's queue-merge checkbox is a separate, unrelated control).
    fireEvent.click(screen.getByText('@@ -20,3 +21,4 @@').closest('label')!.querySelector('input')!)
    expect(await screen.findByText(/1 \/ 2 hunk\(s\) selected/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Apply 1 selected hunk/ }))
    await waitFor(() => expect(applyHunks).toHaveBeenCalledTimes(1))
    const [calledSession, calledPatch] = applyHunks.mock.calls[0]
    expect(calledSession).toBe('s1')
    expect(calledPatch).toContain('+added-top')
    expect(calledPatch).not.toContain('+added-bottom')

    expect(await screen.findByText(/Applied 1 hunk\(s\) to base/)).toBeTruthy()
  })

  it('Apply button is disabled when no hunks are selected', async () => {
    diff.mockResolvedValue(
      ['diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt', '@@ -1,2 +1,3 @@', ' a', '+b', ' c', ''].join('\n')
    )
    list = [{ sessionId: 's1', path: '/wt/s1', branch: 'agent/s1', base: 'main', kind: 'agent', label: 'Claude 1' }]
    render(<ReviewPanel />)
    await screen.findByText('Claude 1')
    fireEvent.click(screen.getByRole('button', { name: 'Select hunks' }))
    await screen.findByText(/1 \/ 1 hunk\(s\) selected/)

    // The only checkbox inside the hunk header text's row (the left pane's
    // queue-merge checkbox is a separate, unrelated control).
    fireEvent.click(screen.getByText('@@ -1,2 +1,3 @@').closest('label')!.querySelector('input')!)
    await screen.findByText(/0 \/ 1 hunk\(s\) selected/)
    const applyBtn = screen.getByRole('button', { name: /Apply 0 selected hunk/ }) as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)
    expect(applyHunks).not.toHaveBeenCalled()
  })
})
