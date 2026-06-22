import { execFile } from 'child_process'
import { promisify } from 'util'
import { join, relative, sep } from 'path'
import { resolveBin } from '../util/resolveBin'

const pexecFile = promisify(execFile)
const GIT = resolveBin('git')

// All git helpers are best-effort: outside a repo or on any error they resolve
// to empty/null rather than throwing. execFile with an arg array avoids any
// shell quoting/injection on paths and commit messages.
async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await pexecFile(GIT, args, { cwd: root, maxBuffer: 1 << 24 })
  return stdout
}

export type GitStatusMap = Record<string, string> // absolute path -> porcelain code

export interface GitChange {
  path: string // absolute
  rel: string // relative to root, forward slashes
  code: string // 2-char porcelain XY
}
export interface GitChanges {
  staged: GitChange[]
  unstaged: GitChange[]
  branch: string
}

// Normalize a porcelain path field: take the new name of a rename, strip quotes.
function cleanPath(field: string): string {
  let p = field.trim()
  if (p.includes(' -> ')) p = p.split(' -> ')[1]
  return p.replace(/^"|"$/g, '')
}

/** Pure parser: porcelain output -> path->code map (exported for tests). */
export function parseStatusMap(out: string, root: string): GitStatusMap {
  const map: GitStatusMap = {}
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    map[join(root, cleanPath(line.slice(3)))] = line.slice(0, 2).trim()
  }
  return map
}

/** Pure parser: porcelain output -> staged/unstaged split (exported for tests). */
export function parseChanges(out: string, root: string): Omit<GitChanges, 'branch'> {
  const staged: GitChange[] = []
  const unstaged: GitChange[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const x = line[0] // index (staged)
    const y = line[1] // worktree (unstaged)
    const rel = cleanPath(line.slice(3))
    const change: GitChange = { path: join(root, rel), rel, code: line.slice(0, 2) }
    if (x !== ' ' && x !== '?') staged.push(change)
    if (y !== ' ') unstaged.push(change)
  }
  return { staged, unstaged }
}

/** Flat path->code map (used for tree badges). */
export async function gitStatus(root: string): Promise<GitStatusMap> {
  try {
    return parseStatusMap(await runGit(root, ['status', '--porcelain']), root)
  } catch {
    return {}
  }
}

/** Staged vs unstaged split + branch, for the git panel. */
export async function gitChanges(root: string): Promise<GitChanges> {
  const result: GitChanges = { staged: [], unstaged: [], branch: '' }
  try {
    result.branch = (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  } catch {
    return result // not a repo
  }
  try {
    const { staged, unstaged } = parseChanges(await runGit(root, ['status', '--porcelain']), root)
    result.staged = staged
    result.unstaged = unstaged
  } catch {
    /* leave empty */
  }
  return result
}

export async function gitHead(root: string, absPath: string): Promise<string | null> {
  try {
    const rel = relative(root, absPath).split(sep).join('/')
    if (rel.startsWith('..')) return null
    return await runGit(root, ['show', `HEAD:${rel}`])
  } catch {
    return null
  }
}

/** Working-tree diff (optionally for one path), capped. Empty on error/no-repo. */
export async function gitDiff(root: string, rel?: string): Promise<string> {
  try {
    const args = ['diff', '--no-color']
    if (rel) args.push('--', rel)
    const out = await runGit(root, args)
    return out.length > 60000 ? out.slice(0, 60000) + '\n[…diff truncated]' : out
  } catch {
    return ''
  }
}

export async function gitStage(root: string, rel: string): Promise<void> {
  await runGit(root, ['add', '--', rel])
}

export async function gitUnstage(root: string, rel: string): Promise<void> {
  // reset is fine even if there's no HEAD yet for new repos? fall back to rm --cached.
  try {
    await runGit(root, ['reset', 'HEAD', '--', rel])
  } catch {
    await runGit(root, ['rm', '--cached', '--', rel])
  }
}

export async function gitCommit(root: string, message: string): Promise<string> {
  try {
    const out = await runGit(root, ['commit', '-m', message])
    return out.trim()
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return `[commit failed] ${(e.stdout || e.stderr || e.message || '').trim()}`
  }
}

// --- Worktree support (agent isolation) ---------------------------------------
// These are NOT best-effort: worktree ops either succeed or throw, so the
// WorktreeManager can fall back (e.g. to the shared root) on failure instead of
// silently proceeding with a half-created worktree.

/** True if `root` is inside a git work tree. */
export async function isGitRepo(root: string): Promise<boolean> {
  try {
    return (await runGit(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
  } catch {
    return false
  }
}

/** `git init` a fresh repo at `root` (best-effort). */
export async function gitInit(root: string): Promise<void> {
  await runGit(root, ['init'])
}

/** The current branch name, or '' outside a repo / detached HEAD. */
export async function currentBranch(root: string): Promise<string> {
  try {
    return (await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  } catch {
    return ''
  }
}

/** True if the repo has at least one commit (worktree -b needs a base commit). */
export async function hasCommits(root: string): Promise<boolean> {
  try {
    await runGit(root, ['rev-parse', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** Add a worktree at `path` on a new branch `branch` based on `base`. Throws on failure. */
export async function worktreeAdd(root: string, path: string, branch: string, base: string): Promise<void> {
  await runGit(root, ['worktree', 'add', '-b', branch, path, base])
}

/** Remove a worktree (force, to drop uncommitted changes on discard). Best-effort. */
export async function worktreeRemove(root: string, path: string): Promise<void> {
  try {
    await runGit(root, ['worktree', 'remove', '--force', path])
  } catch {
    /* already gone / never created */
  }
}

/** Delete a branch (force). Best-effort — used when discarding a worktree. */
export async function branchDelete(root: string, branch: string): Promise<void> {
  try {
    await runGit(root, ['branch', '-D', branch])
  } catch {
    /* no such branch */
  }
}

/** Prune stale worktree admin entries (e.g. after a crash). Best-effort. */
export async function worktreePrune(root: string): Promise<void> {
  try {
    await runGit(root, ['worktree', 'prune'])
  } catch {
    /* ignore */
  }
}

export interface WorktreeEntry {
  path: string // absolute worktree path
  branch: string // branch name (refs/heads/… stripped), or '' if detached
}

/** Parse `git worktree list --porcelain` output (exported for tests). */
export function parseWorktreeList(out: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let cur: Partial<WorktreeEntry> = {}
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? '' })
      cur = { path: line.slice('worktree '.length).trim() }
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    }
  }
  if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? '' })
  return entries
}

/** List all worktrees of the repo at `root`. Empty on error/no-repo. */
export async function worktreeList(root: string): Promise<WorktreeEntry[]> {
  try {
    return parseWorktreeList(await runGit(root, ['worktree', 'list', '--porcelain']))
  } catch {
    return []
  }
}

/**
 * Total work in a worktree vs its base branch: a plain `git diff <base>` run
 * INSIDE the worktree, so it captures both committed branch history and any
 * uncommitted working changes (agents/pipelines write files but may not commit).
 * Capped. For the review UI.
 */
export async function workingDiff(worktreePath: string, base: string): Promise<string> {
  try {
    // Diff against the MERGE-BASE (the commit the branch forked from), not the
    // live `base` ref — `base` (e.g. "main") keeps moving as the user commits, and
    // diffing a stale worktree against the moved tip would show those unrelated
    // later commits inverted as deletions. The merge-base is the stable fork point,
    // so this shows only what THIS worktree actually changed (committed + working).
    let from = base
    try {
      from = (await runGit(worktreePath, ['merge-base', base, 'HEAD'])).trim() || base
    } catch {
      /* base ref unresolvable — fall back to the ref itself */
    }
    const out = await runGit(worktreePath, ['diff', '--no-color', from])
    return out.length > 200000 ? out.slice(0, 200000) + '\n[…diff truncated]' : out
  } catch {
    return ''
  }
}

/**
 * Stage and commit everything in a worktree (best-effort; no-op when clean).
 * Returns true if a commit was made. Used before a squash-merge so uncommitted
 * agent work is included.
 */
export async function commitAll(worktreePath: string, message: string): Promise<boolean> {
  try {
    await runGit(worktreePath, ['add', '-A'])
    // `commit` exits non-zero when there's nothing staged — treat as no-op.
    await runGit(worktreePath, ['commit', '-m', message])
    return true
  } catch {
    return false
  }
}

/**
 * Squash-merge `branch` into the current branch of `root` and commit. Returns a
 * status string. On conflict the merge is aborted and the working tree restored,
 * so the caller can fall back to manual review. Used by the review-merge flow.
 */
export async function squashMergeBranch(root: string, branch: string, message: string): Promise<string> {
  try {
    await runGit(root, ['merge', '--squash', branch])
    const out = await runGit(root, ['commit', '-m', message])
    return out.trim()
  } catch (err) {
    // Abort a partial/conflicted merge so the base worktree is left clean.
    await runGit(root, ['merge', '--abort']).catch(() => {})
    await runGit(root, ['reset', '--hard']).catch(() => {})
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return `[merge failed] ${(e.stdout || e.stderr || e.message || '').trim()}`
  }
}
