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
