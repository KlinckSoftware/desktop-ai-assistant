import { useCallback, useEffect, useState } from 'react'
import type { GitChange, GitChanges } from '@shared/types'
import { useAppStore } from '../store/appStore'

const EMPTY: GitChanges = { staged: [], unstaged: [], branch: '' }

export default function GitPanel({ onOpenDiff }: { onOpenDiff?: () => void }): JSX.Element {
  const [changes, setChanges] = useState<GitChanges>(EMPTY)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)

  const refresh = useCallback(() => {
    window.api.git.changes().then(setChanges)
  }, [])

  useEffect(() => {
    refresh()
    const off = window.api.fs.onChanged(() => refresh())
    return off
  }, [refresh])

  const open = (c: GitChange): void => {
    setSelectedFile(c.path)
    onOpenDiff?.()
  }

  const stage = async (rel: string): Promise<void> => {
    await window.api.git.stage(rel)
    refresh()
  }
  const unstage = async (rel: string): Promise<void> => {
    await window.api.git.unstage(rel)
    refresh()
  }
  const stageAll = async (): Promise<void> => {
    await Promise.all(changes.unstaged.map((c) => window.api.git.stage(c.rel)))
    refresh()
  }

  const commit = async (): Promise<void> => {
    if (!message.trim() || changes.staged.length === 0 || busy) return
    setBusy(true)
    const out = await window.api.git.commit(message.trim())
    setBusy(false)
    setResult(out)
    if (!out.startsWith('[commit failed]')) setMessage('')
    refresh()
  }

  const Row = ({ c, staged }: { c: GitChange; staged: boolean }): JSX.Element => (
    <div className="group flex items-center gap-1 px-2 py-0.5 hover:bg-bg">
      <span className="w-6 shrink-0 font-mono text-[10px] text-yellow-400">{c.code.trim()}</span>
      <span className="flex-1 cursor-pointer truncate text-gray-300" onClick={() => open(c)}>
        {c.rel}
      </span>
      <button
        className="shrink-0 text-gray-500 opacity-0 hover:text-accent group-hover:opacity-100"
        onClick={() => (staged ? unstage(c.rel) : stage(c.rel))}
        title={staged ? 'Unstage' : 'Stage'}
        aria-label={staged ? `Unstage ${c.rel}` : `Stage ${c.rel}`}
      >
        {staged ? '−' : '+'}
      </button>
    </div>
  )

  if (!changes.branch) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-sm text-gray-500">
        Not a git repository
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg text-xs">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-semibold text-accent">Git · {changes.branch}</span>
        <button
          className="rounded px-1.5 text-gray-400 hover:bg-panel"
          onClick={refresh}
          aria-label="Refresh git status"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase text-gray-500">
          <span>Staged ({changes.staged.length})</span>
        </div>
        {changes.staged.map((c) => (
          <Row key={c.rel} c={c} staged />
        ))}

        <div className="flex items-center justify-between border-t border-border px-2 py-1 text-[10px] uppercase text-gray-500">
          <span>Changes ({changes.unstaged.length})</span>
          {changes.unstaged.length > 0 && (
            <button className="text-accent hover:underline" onClick={stageAll}>
              stage all
            </button>
          )}
        </div>
        {changes.unstaged.map((c) => (
          <Row key={c.rel} c={c} staged={false} />
        ))}
      </div>

      <div className="border-t border-border p-2">
        {result && (
          <div
            className={`mb-1 max-h-16 overflow-auto rounded px-2 py-1 text-[11px] ${result.startsWith('[commit failed]') ? 'bg-red-500/15 text-red-300' : 'bg-green-500/10 text-green-300'}`}
          >
            {result}
          </div>
        )}
        <textarea
          className="mb-1 w-full resize-none rounded border border-border bg-panel px-2 py-1 text-xs outline-none focus:border-accent"
          rows={2}
          placeholder="Commit message…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          className="w-full rounded bg-accent py-1 text-xs font-medium text-black disabled:opacity-40"
          disabled={busy || !message.trim() || changes.staged.length === 0}
          onClick={commit}
        >
          {busy ? 'Committing…' : `Commit ${changes.staged.length} staged`}
        </button>
      </div>
    </div>
  )
}
