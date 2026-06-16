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

/** Flat path->code map (used for tree badges). */
export async function gitStatus(root: string): Promise<GitStatusMap> {
  try {
    const out = await runGit(root, ['status', '--porcelain'])
    const map: GitStatusMap = {}
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const code = line.slice(0, 2).trim()
      let p = line.slice(3).trim()
      if (p.includes(' -> ')) p = p.split(' -> ')[1]
      p = p.replace(/^"|"$/g, '')
      map[join(root, p)] = code
    }
    return map
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
    const out = await runGit(root, ['status', '--porcelain'])
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const x = line[0] // index (staged) status
      const y = line[1] // worktree (unstaged) status
      let p = line.slice(3).trim()
      if (p.includes(' -> ')) p = p.split(' -> ')[1]
      p = p.replace(/^"|"$/g, '')
      const rel = p
      const abs = join(root, p)
      if (x !== ' ' && x !== '?') result.staged.push({ path: abs, rel, code: line.slice(0, 2) })
      if (y !== ' ') result.unstaged.push({ path: abs, rel, code: line.slice(0, 2) })
    }
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
