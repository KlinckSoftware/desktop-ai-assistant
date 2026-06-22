import { useCallback, useEffect, useState } from 'react'
import type { RunInfo } from '@shared/types'

// Live view of every pipeline run — manual, background, or scheduled. Reads the
// main-owned run list (RunManager), so a job that fired while no panel was open
// still shows up here with its full step output. Refreshes on each run update.
const STATUS: Record<RunInfo['status'], { label: string; cls: string }> = {
  queued: { label: 'queued', cls: 'text-gray-400' },
  running: { label: 'running', cls: 'text-accent' },
  done: { label: 'done', cls: 'text-green-400' },
  error: { label: 'error', cls: 'text-red-400' },
  cancelled: { label: 'cancelled', cls: 'text-yellow-400' }
}

export default function RunsPanel(): JSX.Element {
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [sel, setSel] = useState('')

  const refresh = useCallback(() => {
    window.api.pipeline.runs().then((rs) => {
      setRuns(rs)
      setSel((cur) => (rs.some((r) => r.id === cur) ? cur : rs[0]?.id ?? ''))
    })
  }, [])

  useEffect(() => {
    refresh()
    const offU = window.api.pipeline.onUpdate(() => refresh())
    const offC = window.api.pipeline.onComplete(() => refresh())
    return () => {
      offU()
      offC()
    }
  }, [refresh])

  const cur = runs.find((r) => r.id === sel)
  const steps = cur?.updates.filter((u) => u.type === 'step' || u.type === 'error') ?? []

  return (
    <div className="flex h-full bg-bg text-xs">
      {/* left: run list */}
      <div className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="border-b border-border px-3 py-1.5 font-semibold text-accent">Runs ({runs.length})</div>
        <div className="flex-1 overflow-auto">
          {runs.length === 0 && (
            <div className="p-3 text-gray-500">No runs yet. Run a pipeline or wait for a scheduled job.</div>
          )}
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => setSel(r.id)}
              className={`block w-full border-b border-border/50 px-2 py-1.5 text-left hover:bg-panel ${
                r.id === sel ? 'bg-panel' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`shrink-0 ${STATUS[r.status].cls}`}>●</span>
                <span className="flex-1 truncate text-gray-200">
                  {r.label}
                  {r.dryRun ? ' [dry]' : ''}
                </span>
              </div>
              <div className="truncate pl-3.5 text-[10px] text-gray-500">
                {STATUS[r.status].label} · {new Date(r.ts).toLocaleTimeString()}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* right: selected run output */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1.5">
          {cur ? (
            <>
              <span className="truncate text-gray-200">{cur.label}</span>
              <span className={`shrink-0 ${STATUS[cur.status].cls}`}>{STATUS[cur.status].label}</span>
              {(cur.status === 'running' || cur.status === 'queued') && (
                <button
                  className="ml-auto shrink-0 rounded bg-red-600 px-2 py-0.5 font-medium text-white"
                  onClick={() => window.api.pipeline.cancel(cur.id)}
                >
                  Stop
                </button>
              )}
            </>
          ) : (
            <span className="text-gray-500">Select a run.</span>
          )}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {cur && steps.length === 0 && (
            <div className="text-gray-500">{cur.status === 'queued' ? 'Queued…' : 'No output yet.'}</div>
          )}
          {steps.map((u, i) => (
            <div key={i} className="rounded-lg border border-border bg-panel p-3">
              <div
                className={`mb-1 text-xs font-semibold uppercase ${u.type === 'error' ? 'text-red-400' : 'text-accent'}`}
              >
                {u.type === 'error' ? 'error' : `${(u.index ?? 0) + 1}. ${u.name ?? u.agentId ?? 'step'}`}
              </div>
              <div className="whitespace-pre-wrap text-gray-200">{u.text}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
