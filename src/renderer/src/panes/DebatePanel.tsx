import { useState } from 'react'
import type { DebateUpdate } from '@shared/types'
import { useAppStore } from '../store/appStore'

// Docked Partner-Debate view. Same logic as the old overlay, without modal
// chrome — dockview owns show/hide/minimize. State lives in the store, so the
// run survives the panel being hidden or closed.
export default function DebatePanel(): JSX.Element {
  const updates = useAppStore((s) => s.debateUpdates)
  const running = useAppStore((s) => s.debateRunning)
  const status = useAppStore((s) => s.debateStatus)
  const awaiting = useAppStore((s) => s.debateAwaiting)
  const startDebateState = useAppStore((s) => s.startDebateState)
  const beginSynthesis = useAppStore((s) => s.beginSynthesis)
  const endDebate = useAppStore((s) => s.endDebate)
  const clearDebate = useAppStore((s) => s.clearDebate)
  const lastPrompt = useAppStore((s) => s.debatePrompt)
  const [prompt, setPrompt] = useState(lastPrompt)

  const clear = (): void => {
    clearDebate()
    setPrompt('')
  }

  const approve = (): void => {
    beginSynthesis()
    window.api.debate.synthesize()
  }
  const decline = (): void => {
    endDebate()
    window.api.debate.decline()
  }

  const start = (): void => {
    const p = prompt.trim()
    if (!p || running) return
    startDebateState(p)
    window.api.debate.start(p).catch((err) => {
      useAppStore.getState().addDebateUpdate({
        type: 'error',
        text: `Failed to start debate: ${err instanceof Error ? err.message : String(err)}`
      })
      endDebate()
    })
  }

  const color = (t: DebateUpdate['type']): string =>
    t === 'claude'
      ? 'text-claude'
      : t === 'gemini'
        ? 'text-gemini'
        : t === 'error'
          ? 'text-red-400'
          : 'text-green-400'

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <input
          className="flex-1 rounded border border-border bg-panel px-2 py-1 outline-none focus:border-accent disabled:opacity-50"
          placeholder="Task for Claude & Gemini to debate…"
          value={prompt}
          disabled={running}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
        <button
          className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
          disabled={running}
          onClick={start}
        >
          {running ? 'Running…' : 'Start'}
        </button>
        <button
          className="rounded border border-border px-3 py-1 text-gray-300 hover:bg-panel disabled:opacity-40"
          disabled={running}
          onClick={clear}
          title="Clear input and transcript"
        >
          Clear
        </button>
      </div>
      {running && (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1 text-xs text-gray-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          {status || 'working…'}
        </div>
      )}
      {awaiting && (
        <div className="flex items-center gap-2 border-b border-border bg-yellow-500/10 px-3 py-2 text-xs">
          <span className="flex-1 text-yellow-300">
            Approve to let Claude implement the agreed changes — this WILL edit files.
          </span>
          <button className="rounded bg-green-600 px-3 py-1 font-medium text-white" onClick={approve}>
            Approve &amp; implement
          </button>
          <button className="rounded border border-border px-3 py-1 text-gray-300" onClick={decline}>
            Decline
          </button>
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {updates.length === 0 && !running && (
          <div className="text-gray-500">
            Enter a task and Start. Claude proposes, Gemini critiques, repeat, then Claude
            synthesizes. This panel can be docked, hidden, or rearranged like any other.
          </div>
        )}
        {updates.map((u, i) => (
          <div key={i} className="rounded-lg border border-border bg-panel p-3">
            <div className={`mb-1 text-xs font-semibold uppercase ${color(u.type)}`}>
              {u.type} {u.round != null && `· round ${u.round + 1}`}
            </div>
            <div className="whitespace-pre-wrap text-gray-200">{u.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
