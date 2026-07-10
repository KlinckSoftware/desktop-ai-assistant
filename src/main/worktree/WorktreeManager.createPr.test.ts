import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the git/gh exec layer so createPr's preflight + push + PR logic can be
// unit-tested without shelling out to real git or gh. See WorktreeManager.stale.test.ts
// for the seeding style and src/main/fs/git.test.ts for the module under mock.
const hasOriginRemote = vi.fn()
const ghAvailable = vi.fn()
const pushBranch = vi.fn()
const ghPrCreate = vi.fn()
const commitAll = vi.fn()

vi.mock('../fs/git', () => ({
  hasOriginRemote: (...args: unknown[]) => hasOriginRemote(...args),
  ghAvailable: (...args: unknown[]) => ghAvailable(...args),
  pushBranch: (...args: unknown[]) => pushBranch(...args),
  ghPrCreate: (...args: unknown[]) => ghPrCreate(...args),
  commitAll: (...args: unknown[]) => commitAll(...args)
}))

import { WorktreeManager } from './WorktreeManager'

// Seed the private session map without touching git (same helper style as
// WorktreeManager.stale.test.ts).
function seed(mgr: WorktreeManager, sessionId: string, path = `/w/${sessionId}`): void {
  const map = (mgr as unknown as { bySession: Map<string, unknown> }).bySession
  map.set(sessionId, { sessionId, path, branch: `agent/${sessionId}`, base: 'main', kind: 'agent' })
}

describe('WorktreeManager.createPr', () => {
  beforeEach(() => {
    hasOriginRemote.mockReset().mockResolvedValue(true)
    ghAvailable.mockReset().mockResolvedValue(true)
    pushBranch.mockReset().mockResolvedValue(undefined)
    ghPrCreate.mockReset().mockResolvedValue('https://github.com/o/r/pull/1')
    commitAll.mockReset().mockResolvedValue(true)
  })

  it('errors on an unknown session without touching git', async () => {
    const mgr = new WorktreeManager()
    const result = await mgr.createPr('/repo', 'nope')
    expect(result).toEqual({ error: 'unknown session' })
    expect(hasOriginRemote).not.toHaveBeenCalled()
  })

  it('errors when there is no origin remote', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a')
    hasOriginRemote.mockResolvedValue(false)
    const result = await mgr.createPr('/repo', 'a')
    expect(result).toEqual({ error: 'no origin remote' })
    expect(ghAvailable).not.toHaveBeenCalled()
    expect(pushBranch).not.toHaveBeenCalled()
  })

  it('errors when the gh CLI is not found', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a')
    ghAvailable.mockResolvedValue(false)
    const result = await mgr.createPr('/repo', 'a')
    expect(result).toEqual({ error: 'gh CLI not found' })
    expect(pushBranch).not.toHaveBeenCalled()
  })

  it('commits uncommitted work, pushes the branch, then creates the PR', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a', '/w/a')
    const result = await mgr.createPr('/repo', 'a')
    expect(commitAll).toHaveBeenCalledWith('/w/a', expect.stringContaining('agent/a'))
    expect(pushBranch).toHaveBeenCalledWith('/w/a', 'agent/a')
    expect(ghPrCreate).toHaveBeenCalledWith('/w/a', 'agent/a', 'agent/a', expect.stringContaining('agent/a'))
    expect(result).toEqual({ url: 'https://github.com/o/r/pull/1' })
  })

  it('uses the session label as the PR title when set', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a', '/w/a')
    mgr.setLabel('a', 'My Agent')
    await mgr.createPr('/repo', 'a')
    expect(ghPrCreate).toHaveBeenCalledWith('/w/a', 'agent/a', 'My Agent', expect.any(String))
  })

  it('returns a push error without calling gh pr create', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a')
    pushBranch.mockRejectedValue({ stderr: 'remote rejected' })
    const result = await mgr.createPr('/repo', 'a')
    expect(result.error).toContain('remote rejected')
    expect(ghPrCreate).not.toHaveBeenCalled()
  })

  it('returns the gh pr create error message on failure', async () => {
    const mgr = new WorktreeManager()
    seed(mgr, 'a')
    ghPrCreate.mockRejectedValue(new Error('no PR found and create failed'))
    const result = await mgr.createPr('/repo', 'a')
    expect(result).toEqual({ error: 'no PR found and create failed' })
  })
})
