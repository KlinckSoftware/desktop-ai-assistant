import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the git exec layer so stats()'s null-on-failure / delegation logic can
// be unit-tested without shelling out to real git. Same style as
// WorktreeManager.createPr.test.ts.
const aheadBehind = vi.fn()

vi.mock('../fs/git', () => ({
  aheadBehind: (...args: unknown[]) => aheadBehind(...args)
}))

import { WorktreeManager } from './WorktreeManager'

// Seed the private session map without touching git (same helper style as
// WorktreeManager.createPr.test.ts / WorktreeManager.stale.test.ts).
function seed(mgr: WorktreeManager, sessionId: string, path = `/w/${sessionId}`, base = 'main'): void {
  const map = (mgr as unknown as { bySession: Map<string, unknown> }).bySession
  map.set(sessionId, { sessionId, path, branch: `agent/${sessionId}`, base, kind: 'agent' })
}

describe('WorktreeManager.stats', () => {
  beforeEach(() => {
    aheadBehind.mockReset()
  })

  it('returns null for an unknown session without touching git', async () => {
    const mgr = new WorktreeManager()
    const result = await mgr.stats('nope')
    expect(result).toBeNull()
    expect(aheadBehind).not.toHaveBeenCalled()
  })

  it('delegates to aheadBehind with the worktree path and base', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a', '/w/a', 'main')
    aheadBehind.mockResolvedValue({ ahead: 3, behind: 1 })
    const result = await mgr.stats('a')
    expect(aheadBehind).toHaveBeenCalledWith('/w/a', 'main')
    expect(result).toEqual({ ahead: 3, behind: 1 })
  })

  it('returns null when aheadBehind fails/returns null', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a')
    aheadBehind.mockResolvedValue(null)
    const result = await mgr.stats('a')
    expect(result).toBeNull()
  })
})
