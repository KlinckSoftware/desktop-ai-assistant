import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { WorktreeManager } from './WorktreeManager'
import { currentBranch, workingDiff } from '../fs/git'
import { parseHunks, buildPatch } from '../../shared/diffHunks'

// Real git in a temp repo — verifies the full per-hunk cherry-pick path end to
// end: create a worktree, edit TWO separate regions of a file (two hunks),
// build a patch containing only one hunk, apply it to the BASE, and assert
// the base got that hunk's change but not the other. This is also the test
// that verifies the "no renumbering needed" assumption in diffHunks.buildPatch —
// git apply must tolerate the unselected hunk being absent from the patch.

let repo: string
let base: string
const git = (args: string[]): void => void execFileSync('git', args, { cwd: repo, stdio: 'ignore' })

const LINES = Array.from({ length: 30 }, (_, i) => `line${i + 1}`)

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), 'dai-wt-hunks-'))
  git(['init'])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(repo, 'f.txt'), LINES.join('\n') + '\n')
  git(['add', '.'])
  git(['commit', '-m', 'init'])
  base = await currentBranch(repo)
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('WorktreeManager.applyHunks (real git)', () => {
  it('applies only the selected hunk to the base, leaving the other change out', async () => {
    const m = new WorktreeManager()
    const wt = await m.create(repo, 'hunks', 'agent')
    expect(wt).toBeTruthy()

    // Edit two well-separated regions so git produces two distinct hunks.
    const edited = [...LINES]
    edited[1] = 'line2-CHANGED-TOP' // near the top
    edited[27] = 'line28-CHANGED-BOTTOM' // near the bottom
    writeFileSync(join(wt!.path, 'f.txt'), edited.join('\n') + '\n')

    const diff = await workingDiff(wt!.path, base)
    const files = parseHunks(diff)
    expect(files).toHaveLength(1)
    expect(files[0].hunks.length).toBeGreaterThanOrEqual(2)

    // Select only the FIRST hunk (top change).
    const patch = buildPatch(files, (_file, idx) => idx === 0)
    expect(patch).toContain('line2-CHANGED-TOP')
    expect(patch).not.toContain('line28-CHANGED-BOTTOM')

    const status = await m.applyHunks(repo, 'hunks', patch)
    expect(status).toBe('')

    const baseContent = readFileSync(join(repo, 'f.txt'), 'utf8')
    expect(baseContent).toContain('line2-CHANGED-TOP')
    expect(baseContent).not.toContain('line28-CHANGED-BOTTOM')
    // Untouched region still intact.
    expect(baseContent).toContain('line15')

    // The worktree itself is left untouched — its file still has both edits.
    const wtContent = readFileSync(join(wt!.path, 'f.txt'), 'utf8')
    expect(wtContent).toContain('line2-CHANGED-TOP')
    expect(wtContent).toContain('line28-CHANGED-BOTTOM')
  })

  it('applying the second hunk only brings in the bottom change', async () => {
    const m = new WorktreeManager()
    const wt = await m.create(repo, 'hunks2', 'agent')

    const edited = [...LINES]
    edited[1] = 'line2-CHANGED-TOP'
    edited[27] = 'line28-CHANGED-BOTTOM'
    writeFileSync(join(wt!.path, 'f.txt'), edited.join('\n') + '\n')

    const diff = await workingDiff(wt!.path, base)
    const files = parseHunks(diff)
    const patch = buildPatch(files, (_file, idx) => idx === files[0].hunks.length - 1)

    const status = await m.applyHunks(repo, 'hunks2', patch)
    expect(status).toBe('')

    const baseContent = readFileSync(join(repo, 'f.txt'), 'utf8')
    expect(baseContent).not.toContain('line2-CHANGED-TOP')
    expect(baseContent).toContain('line28-CHANGED-BOTTOM')
  })

  it('returns empty status for an unknown session without touching the base', async () => {
    const m = new WorktreeManager()
    const before = readFileSync(join(repo, 'f.txt'), 'utf8')
    const status = await m.applyHunks(repo, 'nope', 'diff --git a/f.txt b/f.txt\n')
    expect(status).toBe('')
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe(before)
  })

  it('returns an [apply failed] status for a patch that cannot apply', async () => {
    const m = new WorktreeManager()
    const wt = await m.create(repo, 'bad', 'agent')
    expect(wt).toBeTruthy()
    const bogus = [
      'diff --git a/f.txt b/f.txt',
      'index 1111111..2222222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -900,3 +900,4 @@',
      ' does-not-exist-context-line',
      '+bogus-addition',
      ' another-nonexistent-line',
      ''
    ].join('\n')
    const status = await m.applyHunks(repo, 'bad', bogus)
    expect(status).toContain('[apply failed]')
  })
})
