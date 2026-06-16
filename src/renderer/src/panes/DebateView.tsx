import { useEffect, useState } from 'react'
import type { DebateUpdate } from '@shared/types'

export default function DebateView({ onClose }: { onClose: () => void }): JSX.Element {
  const [updates, setUpdates] = useState<DebateUpdate[]>([])
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const off = window.api.debate.onUpdate((u) => {
      setUpdates((prev) => [...prev, u])
      if (u.type === 'synthesis') setRunning(false)
    })
    return off
  }, [])

  const start = (): void => {
    if (!prompt.trim()) return
    setUpdates([])
    setRunning(true)
    window.api.debate.start(prompt.trim())
  }

  const color = (t: DebateUpdate['type']): string =>
    t === 'claude' ? 'text-claude' : t === 'gemini' ? 'text-gemini' : 'text-green-400'

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg/95 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <span className="font-semibold text-accent">Partner Coding Session (Debate)</span>
        <button className="ml-auto rounded px-2 text-gray-400 hover:bg-panel" onClick={onClose}>
          ✕ close
        </button>
      </div>
      <div className="flex gap-2 border-b border-border p-3">
        <input
          className="flex-1 rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent"
          placeholder="Task for Claude & Gemini to debate…"
          value={prompt}
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
