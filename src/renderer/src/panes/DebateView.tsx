import { useState } from 'react'
import type { DebateUpdate } from '@shared/types'
import { useAppStore } from '../store/appStore'

export default function DebateView({ onClose }: { onClose: () => void }): JSX.Element {
  const updates = useAppStore((s) => s.debateUpdates)
  const running = useAppStore((s) => s.debateRunning)
  const status = useAppStore((s) => s.debateStatus)
  const startDebateState = useAppStore((s) => s.startDebateState)
  const endDebate = useAppStore((s) => s.endDebate)
  const lastPrompt = useAppStore((s) => s.debatePrompt)
  const [prompt, setPrompt] = useState(lastPrompt)

  const start = (): void => {
    const p = prompt.trim()
    if (!p || running) return
    startDebateState(p)
    // Backend pushes results via the always-mounted listener in App.
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
    <div className="fixed inset-0 z-40 flex flex-col bg-bg/95 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <span className="font-semibold text-accent">Partner Coding Session (Debate)</span>
        {running && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
            {status || 'working…'}
          </span>
        )}
        <button
          className="ml-auto rounded px-2 text-gray-400 hover:bg-panel"
          onClick={onClose}
          title={running ? 'Minimize (keeps running)' : 'Close'}
        >
          {running ? '— minimize' : '✕ close'}
        </button>
      </div>

      <div className="flex gap-2 border-b border-border p-3">
        <input
          className="flex-1 rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
          placeholder="Task for Claude & Gemini to debate…"
          value={prompt}
          disabled={running}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && start()}
        />
        <button
          className="rounded bg-accent px-4 text-sm font-medium text-black disabled:opacity-40"
          disabled={running}
          onClick={start}
        >
          {running ? 'Running…' : 'Start'}
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {updates.length === 0 && !running && (
          <div className="text-gray-500">
            Enter a task and hit Start. Claude proposes, Gemini critiques, repeat 3 rounds, then
            Claude synthesizes. You can minimize this while it runs.
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
        {running && (
          <div className="flex items-center gap-2 px-1 text-xs text-gray-500">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-600 border-t-accent" />
            {status || 'working…'}
          </div>
        )}
      </div>
    </div>
  )
}
