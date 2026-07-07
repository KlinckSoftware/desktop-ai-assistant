import { useCallback, useEffect, useMemo, useState } from 'react'
import { html } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import type { WorktreeInfo } from '@shared/types'

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

  const refresh = useCallback(() => {
    window.api.worktree.list().then((list) => {
      setWorktrees(list)
      // Keep a valid selection; default to the first when none/stale.
      setSelected((cur) => (list.some((w) => w.sessionId === cur) ? cur : list[0]?.sessionId ?? ''))
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

  const discardAll = async (): Promise<void> => {
    if (!worktrees.length) return
    if (!window.confirm(`Discard all ${worktrees.length} branch(es) and their worktrees? This cannot be undone.`)) return
    setBusy(true)
    for (const w of worktrees) await window.api.worktree.remove(w.sessionId, 'discard')
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
          {worktrees.length > 0 && (
            <button
              disabled={busy}
              onClick={discardAll}
              className="ml-auto rounded border border-red-700/60 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-900/30 disabled:opacity-50"
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
          {worktrees.map((w) => (
            <button
              key={w.sessionId}
              onClick={() => setSelected(w.sessionId)}
              className={`block w-full border-b border-border/50 px-2 py-1.5 text-left hover:bg-panel ${
                w.sessionId === selected ? 'bg-panel' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-gray-200">
                  <span className="mr-1 text-gray-500">{w.kind === 'pipeline' ? '⛓' : '◆'}</span>
                  {w.label || w.kind}
                </span>
                {w.mtime !== undefined && <span className="shrink-0 text-[10px] text-gray-600">{ageLabel(w.mtime)}</span>}
              </div>
              <div className="truncate font-mono text-[10px] text-gray-500">{w.branch}</div>
            </button>
          ))}
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
              <button
                disabled={busy}
                onClick={() => act('merge')}
                className="ml-auto shrink-0 rounded border border-green-700/60 px-2 py-0.5 text-green-300 hover:bg-green-900/30 disabled:opacity-50"
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
