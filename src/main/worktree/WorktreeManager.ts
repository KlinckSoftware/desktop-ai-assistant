import { join } from 'path'
import { existsSync, promises as fsp, statSync } from 'fs'
import {
  isGitRepo,
  hasCommits,
  currentBranch,
  worktreeAdd,
  worktreeRemove,
  worktreePrune,
  worktreeList,
  branchDelete,
  commitAll,
  isWorktreeIdle,
  squashMergeBranch,
  hasOriginRemote,
  ghAvailable,
  pushBranch,
  ghPrCreate
} from '../fs/git'

// Per-session git worktree isolation. Each CLI/API agent session can run in its
// own worktree on its own branch, so parallel agents never stomp each other's
// files and an unsandboxed CLI agent is confined to a branch (it can't corrupt
// the user's working tree). A pipeline run gets ONE shared worktree for all its
// steps. The base repo is appState.projectRoot; worktrees live under .dai-trees/.

export const WORKTREE_DIR = '.dai-trees'

export type WorktreeKind = 'agent' | 'pipeline'

export interface Worktree {
  sessionId: string
  path: string // absolute worktree path
  branch: string // the session's branch (e.g. agent/<id>)
  base: string // the branch it was forked from (merge/diff target)
  kind: WorktreeKind
}

// --- pure helpers (unit-tested) ----------------------------------------------

/** Make a session id safe for a branch name / directory segment. */
export function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'session'
}

/** Branch name for a session: `agent/<id>` or `pipeline/<id>`. */
export function branchName(kind: WorktreeKind, id: string): string {
  return `${kind}/${sanitizeId(id)}`
}

/** Absolute worktree path for a session under the repo's .dai-trees dir. */
export function worktreePath(repoRoot: string, kind: WorktreeKind, id: string): string {
  return join(repoRoot, WORKTREE_DIR, `${kind}-${sanitizeId(id)}`)
}

// --- manager -----------------------------------------------------------------

export class WorktreeManager {
  private bySession = new Map<string, Worktree>()
  private labels = new Map<string, string>() // sessionId -> human label
  private excludeEnsured = new Set<string>() // repo roots whose exclude we've patched

  /** Attach a human-readable label (agent / pipeline name) to a session. */
  setLabel(sessionId: string, label: string): void {
    this.labels.set(sessionId, label)
  }

  /** Serializable view for the renderer (the review/merge UI). */
  infos(): import('../../shared/types').WorktreeInfo[] {
    return [...this.bySession.values()].map((w) => ({
      sessionId: w.sessionId,
      path: w.path,
      branch: w.branch,
      base: w.base,
      kind: w.kind,
      label: this.labels.get(w.sessionId),
      mtime: this.mtimeOf(w.path)
    }))
  }

  private mtimeOf(path: string): number | undefined {
    try {
      return statSync(path).mtimeMs
    } catch {
      return undefined
    }
  }

  /**
   * Summary of adopted worktrees older than `thresholdDays` (by dir mtime).
   * These carry unmerged work — surfaced on boot so stale branches don't pile
   * up unnoticed. Returns null when nothing is stale.
   */
  staleNotice(thresholdDays = 7): import('../../shared/types').WorktreeStaleNotice | null {
    const now = Date.now()
    const cutoff = thresholdDays * 86_400_000
    let count = 0
    let oldest = 0
    for (const w of this.bySession.values()) {
      const m = this.mtimeOf(w.path)
      if (m === undefined) continue
      const age = now - m
      if (age >= cutoff) {
        count++
        oldest = Math.max(oldest, age)
      }
    }
    if (count === 0) return null
    return { count, oldestDays: Math.floor(oldest / 86_400_000), thresholdDays }
  }

  /**
   * Create an isolated worktree for a session. Returns the worktree, or null if
   * isolation isn't possible (not a repo, or no commits to branch from) — the
   * caller then falls back to the shared root. Idempotent per session.
   */
  async create(repoRoot: string, sessionId: string, kind: WorktreeKind): Promise<Worktree | null> {
    const existing = this.bySession.get(sessionId)
    if (existing) return existing
    if (!(await isGitRepo(repoRoot))) return null
    // `worktree add -b` needs a base commit; a fresh repo with no commits can't isolate.
    if (!(await hasCommits(repoRoot))) return null

    const base = (await currentBranch(repoRoot)) || 'HEAD'
    const branch = branchName(kind, sessionId)
    const path = worktreePath(repoRoot, kind, sessionId)

    await this.ensureExcluded(repoRoot)
    try {
      await worktreeAdd(repoRoot, path, branch, base)
    } catch {
      // Branch/path may be left over from a crash — prune and retry once.
      await worktreePrune(repoRoot)
      await worktreeRemove(repoRoot, path)
      await branchDelete(repoRoot, branch)
      try {
        await worktreeAdd(repoRoot, path, branch, base)
      } catch {
        return null // give up; caller falls back to the shared root
      }
    }

    const wt: Worktree = { sessionId, path, branch, base, kind }
    this.bySession.set(sessionId, wt)
    return wt
  }

  get(sessionId: string): Worktree | undefined {
    return this.bySession.get(sessionId)
  }

  list(): Worktree[] {
    return [...this.bySession.values()]
  }

  /**
   * Tear down a session's worktree. 'discard' force-removes the worktree and
   * deletes its branch (losing uncommitted + committed branch work). 'merge'
   * squash-merges the branch back into its base first, then removes. Returns a
   * status string ('' when nothing to do).
   */
  async remove(repoRoot: string, sessionId: string, mode: 'merge' | 'discard'): Promise<string> {
    const wt = this.bySession.get(sessionId)
    if (!wt) return ''
    this.bySession.delete(sessionId)
    this.labels.delete(sessionId)

    let status = ''
    if (mode === 'merge') {
      // Agents/pipelines write files but may not commit — capture any working
      // changes as a commit on the branch first, so the squash-merge includes them.
      await commitAll(wt.path, `work on ${wt.branch}`)
      status = await squashMergeBranch(repoRoot, wt.branch, `merge ${wt.branch}`)
    }
    await worktreeRemove(repoRoot, wt.path)
    if (mode === 'discard' || !status.startsWith('[merge failed]')) {
      await branchDelete(repoRoot, wt.branch)
    }
    return status
  }

  /**
   * Opt-in, user-clicked: push a session's branch to origin and open a GitHub
   * PR for it via the `gh` CLI. Never invoked automatically. Preflights the
   * origin remote and `gh` CLI before touching anything; on success returns the
   * PR URL, on any failure returns a human-readable error instead of throwing.
   */
  async createPr(repoRoot: string, sessionId: string): Promise<{ url?: string; error?: string }> {
    const wt = this.bySession.get(sessionId)
    if (!wt) return { error: 'unknown session' }

    if (!(await hasOriginRemote(repoRoot))) return { error: 'no origin remote' }
    if (!(await ghAvailable())) return { error: 'gh CLI not found' }

    // Agents/pipelines write files but may not commit — capture any working
    // changes first so the PR reflects the full state of the worktree.
    await commitAll(wt.path, `work on ${wt.branch}`)

    try {
      await pushBranch(wt.path, wt.branch)
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      return { error: `push failed: ${(e.stderr || e.stdout || e.message || '').trim()}` }
    }

    const title = this.labels.get(sessionId) || wt.branch
    const body = `Agent worktree ${wt.branch} from Desktop AI Assistant.`
    try {
      const url = await ghPrCreate(wt.path, wt.branch, title, body)
      return { url }
    } catch (err) {
      const e = err as { message?: string }
      return { error: e.message || 'gh pr create failed' }
    }
  }

  /**
   * On boot: prune stale admin state left by a crash, AUTO-REMOVE idle worktrees
   * (nothing to review — e.g. a startup agent that never wrote), and re-adopt the
   * rest (under .dai-trees/, on an agent/ or pipeline/ branch) so they reappear in
   * the review list. The original base branch isn't recorded on disk, so the
   * current branch is used as the base — adequate for the idle check + review.
   * Safe to remove here: this runs before any agent pty is spawned, so no live
   * session owns these worktrees.
   */
  async pruneOnBoot(repoRoot: string): Promise<void> {
    if (!(await isGitRepo(repoRoot))) return
    await worktreePrune(repoRoot)
    const base = (await currentBranch(repoRoot)) || 'HEAD'
    for (const e of await worktreeList(repoRoot)) {
      if (!e.path.includes(WORKTREE_DIR)) continue
      const m = e.branch.match(/^(agent|pipeline)\/(.+)$/)
      if (!m) continue
      const [, kind, sessionId] = m
      if (this.bySession.has(sessionId)) continue
      if (await isWorktreeIdle(e.path, base)) {
        await worktreeRemove(repoRoot, e.path)
        await branchDelete(repoRoot, e.branch)
        continue
      }
      this.bySession.set(sessionId, { sessionId, path: e.path, branch: e.branch, base, kind: kind as WorktreeKind })
    }
    await worktreePrune(repoRoot) // tidy admin entries for anything just removed
  }

  // Add `.dai-trees/` to .git/info/exclude (repo-local, untracked) so worktree
  // dirs never show up as changes in the user's tree. Done once per repo root.
  private async ensureExcluded(repoRoot: string): Promise<void> {
    if (this.excludeEnsured.has(repoRoot)) return
    this.excludeEnsured.add(repoRoot)
    const excludePath = join(repoRoot, '.git', 'info', 'exclude')
    try {
      let body = ''
      if (existsSync(excludePath)) body = await fsp.readFile(excludePath, 'utf8')
      if (!body.split('\n').some((l) => l.trim() === `${WORKTREE_DIR}/`)) {
        await fsp.appendFile(excludePath, `${body.endsWith('\n') || !body ? '' : '\n'}${WORKTREE_DIR}/\n`)
      }
    } catch {
      /* .git/info may not exist for a worktree/submodule layout — non-fatal */
    }
  }
}

export const worktreeManager = new WorktreeManager()
