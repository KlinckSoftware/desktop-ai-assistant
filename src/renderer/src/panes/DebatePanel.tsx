import { useEffect, useState } from 'react'
import type { DebateUpdate, DebateAgent } from '@shared/types'
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
  const sideA = useAppStore((s) => s.debateSideA)
  const sideB = useAppStore((s) => s.debateSideB)
  const setDebateSides = useAppStore((s) => s.setDebateSides)
  const [prompt, setPrompt] = useState(lastPrompt)
  const [participants, setParticipants] = useState<DebateAgent[]>([])

  // Load the participants the user can actually use (keyed APIs + available CLIs).
  useEffect(() => {
    window.api.debate.agents().then((list) => {
      setParticipants(list)
      // If saved sides aren't usable anymore, fall back to the first two available.
      const ids = new Set(list.map((p) => p.id))
      const a = ids.has(sideA) ? sideA : list[0]?.id
      const b = ids.has(sideB) ? sideB : list.find((p) => p.id !== a)?.id
      if (a && b && (a !== sideA || b !== sideB)) setDebateSides(a, b)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    window.api.debate.start(p, sideA, sideB).catch((err) => {
      useAppStore.getState().addDebateUpdate({
        type: 'error',
        text: `Failed to start debate: ${err instanceof Error ? err.message : String(err)}`
      })
      endDebate()
    })
  }

  const color = (u: DebateUpdate): string =>
    u.type === 'turn'
      ? u.side === 'a'
        ? 'text-claude'
        : 'text-gemini'
      : u.type === 'error'
        ? 'text-red-400'
        : 'text-green-400'

  // Label shown on each update block: participant name, or the meta-type.
  const label = (u: DebateUpdate): string =>
    u.type === 'turn' ? (u.name ?? (u.side === 'a' ? 'A' : 'B')) : u.type

  const onlyOneSide = participants.length < 2

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <select
            className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-1 text-claude outline-none focus:border-accent disabled:opacity-50"
            value={sideA}
            disabled={running}
            onChange={(e) => setDebateSides(e.target.value, sideB)}
            title="Participant A (proposes, then synthesizes)"
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <span className="shrink-0 text-gray-500">vs</span>
          <select
            className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-1 text-gemini outline-none focus:border-accent disabled:opacity-50"
            value={sideB}
            disabled={running}
            onChange={(e) => setDebateSides(sideA, e.target.value)}
            title="Participant B (critiques)"
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded border border-border bg-panel px-2 py-1 outline-none focus:border-accent disabled:opacity-50"
            placeholder="Task to debate…"
            value={prompt}
            disabled={running}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
          />
          <button
            className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
            disabled={running || onlyOneSide}
            onClick={start}
            title={onlyOneSide ? 'Need at least 2 working models/APIs (add a key or install a CLI)' : ''}
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
        {onlyOneSide && (
          <div className="text-[11px] text-yellow-400">
            Need ≥2 usable models. Add an API key or install a CLI agent (e.g. Claude).
          </div>
        )}
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
            Pick two models, enter a task, Start. A proposes, B critiques, repeat, then A
            synthesizes. Only models/APIs you have working appear in the dropdowns.
          </div>
        )}
        {updates.map((u, i) => (
          <div key={i} className="rounded-lg border border-border bg-panel p-3">
            <div className={`mb-1 text-xs font-semibold uppercase ${color(u)}`}>
              {label(u)} {u.round != null && `· round ${u.round + 1}`}
            </div>
            <div className="whitespace-pre-wrap text-gray-200">{u.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
