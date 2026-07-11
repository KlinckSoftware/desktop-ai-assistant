import { useCallback, useEffect, useMemo, useState } from 'react'
import { html } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import type { WorktreeInfo, WorktreeStats } from '@shared/types'

// Compact age label from an mtime (epoch ms): "3d", "5h", "just now".
function ageLabel(mtime: number): string {
  const ms = Date.now() - mtime
  const d = Math.floor(ms / 86_400_000)
  if (d >= 1) return `${d}d`
  const h = Math.floor(ms / 3_600_000)
  if (h >= 1) return `${h}h`
  return 'new'
}

// Review & merge the work an isolated agent/pipeline did on its own branch.
// Each worktree's total change (committed + uncommitted, vs its base) is shown
// as a diff; Merge squash-merges the branch into its base, Discard throws it away.
export default function ReviewPanel(): JSX.Element {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [selected, setSelected] = useState<string>('')
  const [diff, setDiff] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [prUrl, setPrUrl] = useState('')
  const [prError, setPrError] = useState('')
  const [stats, setStats] = useState<Record<string, WorktreeStats>>({})
  const [queued, setQueued] = useState<Record<string, boolean>>({})

  const refresh = useCallback(() => {
    window.api.worktree.list().then((list) => {
      setWorktrees(list)
      // Keep a valid selection; default to the first when none/stale.
      setSelected((cur) => (list.some((w) => w.sessionId === cur) ? cur : list[0]?.sessionId ?? ''))
      // Drop queue-selection for worktrees that no longer exist.
      setQueued((cur) => {
        const next: Record<string, boolean> = {}
        for (const w of list) if (cur[w.sessionId]) next[w.sessionId] = true
        return next
      })
      // Fetch ahead/behind lazily per worktree; tolerate failures silently —
      // a worktree just shows no stats rather than an error.
      Promise.all(
        list.map((w) =>
          window.api.worktree
            .stats(w.sessionId)
            .then((s) => [w.sessionId, s] as const)
            .catch(() => [w.sessionId, null] as const)
        )
      ).then((results) => {
        setStats((cur) => {
          const next = { ...cur }
          for (const [sessionId, s] of results) {
            if (s) next[sessionId] = s
            else delete next[sessionId]
          }
          return next
        })
      })
    })
  }, [])

  useEffect(() => {
    refresh()
    return window.api.worktree.onChanged(refresh)
  }, [refresh])

  const loadDiff = useCallback((sessionId: string) => {
    if (!sessionId) {
      setDiff('')
      return
    }
    window.api.worktree.diff(sessionId).then(setDiff)
  }, [])

  useEffect(() => {
    loadDiff(selected)
    setPrUrl('')
    setPrError('')
  }, [selected, loadDiff, worktrees])

  const diffHtml = useMemo(() => {
    if (!diff.trim()) return ''
    return html(diff, { outputFormat: 'side-by-side', drawFileList: true, colorScheme: ColorSchemeType.DARK })
  }, [diff])

  const act = async (mode: 'merge' | 'discard'): Promise<void> => {
    if (!selected) return
    if (mode === 'discard' && !window.confirm('Discard this branch and all its work? This cannot be undone.')) return
    setBusy(true)
    setMsg('')
    const status = await window.api.worktree.remove(selected, mode)
    setBusy(false)
    setMsg(status || (mode === 'merge' ? 'Merged.' : 'Discarded.'))
    setTimeout(() => setMsg(''), 6000)
    refresh()
  }

  // Opt-in, user-clicked only: push the branch to origin and open a GitHub PR.
  // Never invoked automatically.
  const createPr = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    setPrUrl('')
    setPrError('')
    const result = await window.api.worktree.createPr(selected)
    setBusy(false)
    if (result.url) setPrUrl(result.url)
    else setPrError(result.error || 'PR creation failed')
  }

  const discardAll = async (): Promise<void> => {
    if (!worktrees.length) return
    if (!window.confirm(`Discard all ${worktrees.length} branch(es) and their worktrees? This cannot be undone.`)) return
    setBusy(true)
    for (const w of worktrees) await window.api.worktree.remove(w.sessionId, 'discard')
    setBusy(false)
    refresh()
  }

  const toggleQueued = (sessionId: string): void => {
    setQueued((cur) => ({ ...cur, [sessionId]: !cur[sessionId] }))
  }

  const queuedList = worktrees.filter((w) => queued[w.sessionId])

  // Sequentially squash-merge the checked worktrees in LIST order. Stops at the
  // first failure (a status starting with '[merge failed]') and surfaces which
  // branch failed + that the rest were skipped, reusing the msg surface.
  const mergeSelected = async (): Promise<void> => {
    if (!queuedList.length) return
    if (
      !window.confirm(`Squash-merge ${queuedList.length} branches into their bases, in list order?`)
    )
      return
    setBusy(true)
    setMsg('')
    for (let i = 0; i < queuedList.length; i++) {
      const w = queuedList[i]
      const status = await window.api.worktree.remove(w.sessionId, 'merge')
      if (status.startsWith('[merge failed]')) {
        const skipped = queuedList.length - i - 1
        setMsg(`${w.label || w.branch}: ${status}${skipped > 0 ? ` — ${skipped} remaining branch(es) skipped` : ''}`)
        break
      }
    }
    setQueued({})
    setBusy(false)
    refresh()
  }

  const cur = worktrees.find((w) => w.sessionId === selected)

  return (
    <div className="flex h-full bg-bg text-xs">
      {/* left: worktree list */}
      <div className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="font-semibold text-accent">Review ({worktrees.length})</span>
          {queuedList.length > 0 && (
            <button
              disabled={busy}
              onClick={mergeSelected}
              className="ml-auto rounded border border-green-700/60 px-1.5 py-0.5 text-[10px] text-green-300 hover:bg-green-900/30 disabled:opacity-50"
              title="Squash-merge the checked branches into their bases, in list order"
            >
              Merge selected ({queuedList.length})
            </button>
          )}
          {worktrees.length > 0 && (
            <button
              disabled={busy}
              onClick={discardAll}
              className={`rounded border border-red-700/60 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/30 disabled:opacity-50 ${
                queuedList.length > 0 ? '' : 'ml-auto'
              }`}
              title="Discard every branch + worktree"
            >
              Discard all
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {worktrees.length === 0 && (
            <div className="p-3 text-gray-500">
              No isolated work yet. Start a CLI agent or run a pipeline (with isolation on) to create a branch.
            </div>
          )}
          {worktrees.map((w) => {
            const s = stats[w.sessionId]
            return (
              <div
                key={w.sessionId}
                className={`flex items-start gap-1.5 border-b border-border/50 px-2 py-1.5 hover:bg-panel ${
                  w.sessionId === selected ? 'bg-panel' : ''
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={!!queued[w.sessionId]}
                  onChange={() => toggleQueued(w.sessionId)}
                  title="Queue this branch for Merge selected"
                />
                <button onClick={() => setSelected(w.sessionId)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-gray-200">
                      <span className="mr-1 text-gray-500">{w.kind === 'pipeline' ? '⛓' : '◆'}</span>
                      {w.label || w.kind}
                    </span>
                    {w.mtime !== undefined && <span className="shrink-0 text-[10px] text-gray-600">{ageLabel(w.mtime)}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-mono text-[10px] text-gray-500">{w.branch}</span>
                    {s && (
                      <span className="shrink-0 font-mono text-[10px] text-gray-500">
                        <span className="text-green-400">↑{s.ahead}</span> <span className="text-red-400">↓{s.behind}</span>
                      </span>
                    )}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* right: diff + actions */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1.5">
          {cur ? (
            <>
              <span className="truncate font-mono text-gray-400">
                {cur.branch} → {cur.base}
              </span>
              {msg && <span className="truncate text-gray-300">{msg}</span>}
              {prUrl && (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    window.api.openExternal(prUrl)
                  }}
                  className="truncate text-blue-400 underline hover:text-blue-300"
                >
                  {prUrl}
                </a>
              )}
              {prError && <span className="truncate text-red-400">{prError}</span>}
              <button
                disabled={busy}
                onClick={createPr}
                className="ml-auto shrink-0 rounded border border-blue-700/60 px-2 py-0.5 text-blue-300 hover:bg-blue-900/30 disabled:opacity-50"
                title="Push this branch to origin and open a GitHub PR"
              >
                PR
              </button>
              <button
                disabled={busy}
                onClick={() => act('merge')}
                className="shrink-0 rounded border border-green-700/60 px-2 py-0.5 text-green-300 hover:bg-green-900/30 disabled:opacity-50"
                title="Squash-merge this branch into its base, then remove the worktree"
              >
                Merge
              </button>
              <button
                disabled={busy}
                onClick={() => act('discard')}
                className="shrink-0 rounded border border-red-700/60 px-2 py-0.5 text-red-300 hover:bg-red-900/30 disabled:opacity-50"
                title="Delete the branch and its work, remove the worktree"
              >
                Discard
              </button>
            </>
          ) : (
            <span className="text-gray-500">Select a branch to review its changes.</span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-bg p-2">
          {cur && !diff.trim() && <div className="p-3 text-gray-500">No changes on this branch vs its base.</div>}
          {diffHtml && <div className="diff2html-wrapper" dangerouslySetInnerHTML={{ __html: diffHtml }} />}
        </div>
      </div>
    </div>
  )
}
