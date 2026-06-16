import { exec } from 'child_process'
import { promisify } from 'util'
import { join, relative, sep } from 'path'

const pexec = promisify(exec)

// Lightweight git helpers for the file tree / diff viewer. All best-effort:
// outside a repo or on any error they return empty/null rather than throwing.

export type GitStatusMap = Record<string, string> // absolute path -> porcelain code (M, ??, A, D…)

export async function gitStatus(root: string): Promise<GitStatusMap> {
  try {
    const { stdout } = await pexec('git status --porcelain', { cwd: root, maxBuffer: 1 << 20 })
    const map: GitStatusMap = {}
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const code = line.slice(0, 2).trim()
      let p = line.slice(3).trim()
      if (p.includes(' -> ')) p = p.split(' -> ')[1] // rename: take the new path
      p = p.replace(/^"|"$/g, '')
      map[join(root, p)] = code
    }
    return map
  } catch {
    return {}
  }
}

/** Contents of a file at HEAD, or null if untracked / not a repo / error. */
export async function gitHead(root: string, absPath: string): Promise<string | null> {
  try {
    const rel = relative(root, absPath).split(sep).join('/')
    if (rel.startsWith('..')) return null
    const { stdout } = await pexec(`git show HEAD:"${rel}"`, { cwd: root, maxBuffer: 1 << 24 })
    return stdout
  } catch {
    return null
  }
}
