import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WorktreeManager } from './WorktreeManager'
import { currentBranch, workingDiff, isWorktreeIdle, worktreeList } from '../fs/git'

// Real git in a temp repo. Covers the isolation engine beyond the happy path:
// idle detection, merge-base diff (regression for the "diff vs moved base"
// bug), merge, discard, and boot reconcile (prune idle / adopt non-idle).

let repo: string
let base: string
const git = (args: string[]): void => void execFileSync('git', args, { cwd: repo, stdio: 'ignore' })

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'dai-wt-'))
  git(['init'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repo, 'seed.txt'), 'seed\n')
  git(['add', '.'])
  git(['commit', '-m', 'init'])
  base = await currentBranch(repo)
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('WorktreeManager (real git)', () => {
  it('creates an isolated worktree on its own branch', async () => {
    const m = new WorktreeManager()
    const wt = await m.create(repo, 'a', 'agent')
    expect(wt).toBeTruthy()
    expect(existsSync(wt!.path)).toBe(true)
    expect(wt!.branch).toBe('agent/a')
    expect(await isWorktreeIdle(wt!.path, base)).toBe(true)
  })

  it('working diff ignores commits added to the base after the fork (merge-base)', async () => {
    const m = new WorktreeManager()
    const wt = await m.create(repo, 'reg', 'agent')
    // advance the base branch AFTER the worktree forked
    writeFileSync(join(repo, 'later.txt'), 'unrelated base work\n')
    git(['add', '.'])
    git(['commit', '-m', 'advance base'])
    // idle worktree → empty diff (not the base's later commit shown inverted)
    expect((await workingDiff(wt!.path, base)).trim()).toBe('')
  })

  it('merge brings the worktree’s file into the base', async () => {
    const m = new WorktreeManager()
    const wt = await m.create(repo, 'edit', 'agent')
    writeFileSync(join(wt!.path, 'feature.txt'), 'from worktree\n')
    expect(await isWorktreeIdle(wt!.path, base)).toBe(false)
    expect((await workingDiff(wt!.path, base)).toLowerCase()).toContain('feature.txt')
    await m.remove(repo, 'edit', 'merge')
    expect(existsSync(join(repo, 'feature.txt'))).toBe(true)
  })

  it('discard removes the worktree + branch and leaves the base untouched', async () => {
    const m = new WorktreeManager()
    const wt = await m.create(repo, 'disc', 'agent')
    writeFileSync(join(wt!.path, 'scratch.txt'), 'junk\n')
    await m.remove(repo, 'disc', 'discard')
    expect(existsSync(wt!.path)).toBe(false)
    expect(existsSync(join(repo, 'scratch.txt'))).toBe(false)
    expect((await worktreeList(repo)).some((w) => w.branch === 'agent/disc')).toBe(false)
  })

  it('pruneOnBoot removes idle worktrees and re-adopts ones with work', async () => {
    const seed = new WorktreeManager()
    const idle = await seed.create(repo, 'idle', 'agent')
    const work = await seed.create(repo, 'work', 'agent')
    writeFileSync(join(work!.path, 'wip.txt'), 'wip\n') // uncommitted → not idle

    const fresh = new WorktreeManager() // simulate a restart (empty in-memory map)
    await fresh.pruneOnBoot(repo)

    expect(existsSync(idle!.path)).toBe(false) // idle pruned from disk
    const adopted = fresh.infos().map((w) => w.sessionId)
    expect(adopted).toContain('work') // non-idle re-adopted
    expect(adopted).not.toContain('idle')
  })
})
