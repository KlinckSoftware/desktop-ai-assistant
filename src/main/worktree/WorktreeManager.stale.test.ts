import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs so statSync returns a controllable mtime per worktree path.
const mtimes = new Map<string, number>()
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    statSync: (p: string) => {
      const m = mtimes.get(p)
      if (m === undefined) throw new Error('ENOENT')
      return { mtimeMs: m }
    }
  }
})

import { WorktreeManager } from './WorktreeManager'

const DAY = 86_400_000

// Seed the private session map without touching git.
function seed(mgr: WorktreeManager, entries: { sessionId: string; path: string }[]): void {
  const map = (mgr as unknown as { bySession: Map<string, unknown> }).bySession
  for (const e of entries) {
    map.set(e.sessionId, { sessionId: e.sessionId, path: e.path, branch: `agent/${e.sessionId}`, base: 'main', kind: 'agent' })
  }
}

describe('WorktreeManager.staleNotice', () => {
  beforeEach(() => mtimes.clear())

  it('returns null when nothing exceeds the threshold', () => {
    const mgr = new WorktreeManager()
    seed(mgr, [{ sessionId: 'a', path: '/w/a' }])
    mtimes.set('/w/a', Date.now() - 2 * DAY)
    expect(mgr.staleNotice(7)).toBeNull()
  })

  it('counts worktrees older than the threshold and reports the oldest', () => {
    const mgr = new WorktreeManager()
    seed(mgr, [
      { sessionId: 'a', path: '/w/a' },
      { sessionId: 'b', path: '/w/b' },
      { sessionId: 'c', path: '/w/c' }
    ])
    mtimes.set('/w/a', Date.now() - 10 * DAY)
    mtimes.set('/w/b', Date.now() - 30 * DAY)
    mtimes.set('/w/c', Date.now() - 1 * DAY) // fresh, excluded
    const n = mgr.staleNotice(7)
    expect(n).toEqual({ count: 2, oldestDays: 30, thresholdDays: 7 })
  })

  it('ignores worktrees whose path cannot be stat-ed', () => {
    const mgr = new WorktreeManager()
    seed(mgr, [{ sessionId: 'gone', path: '/w/gone' }]) // no mtime seeded -> throws
    expect(mgr.staleNotice(7)).toBeNull()
  })
})
