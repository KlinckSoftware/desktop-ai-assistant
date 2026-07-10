import { useEffect, useState } from 'react'
import type { DebateUpdate, DebateAgent } from '@shared/types'
import { useAppStore } from '../store/appStore'

const MIN_SEATS = 2
const MAX_SEATS = 4

// Cycles through the app's themed colors, then falls back to a small Tailwind
// palette for the 3rd/4th seat (only two debate colors are defined globally).
const SEAT_COLORS = ['text-claude', 'text-gemini', 'text-purple-400', 'text-orange-400']

// Docked Partner-Debate view. Same logic as the old overlay, without modal
// chrome — dockview owns show/hide/minimize. State lives in the store, so the
// run survives the panel being hidden or closed.
export default function DebatePanel(): JSX.Element {
  const updates = useAppStore((s) => s.debateUpdates)
  const running = useAppStore((s) => s.debateRunning)
  const status = useAppStore((s) => s.debateStatus)
  const awaiting = useAppStore((s) => s.debateAwaiting)
  const awaitText = useAppStore((s) => s.debateAwaitText)
  const startDebateState = useAppStore((s) => s.startDebateState)
  const beginSynthesis = useAppStore((s) => s.beginSynthesis)
  const endDebate = useAppStore((s) => s.endDebate)
  const clearDebate = useAppStore((s) => s.clearDebate)
  const lastPrompt = useAppStore((s) => s.debatePrompt)
  const sideA = useAppStore((s) => s.debateSideA)
  const sideB = useAppStore((s) => s.debateSideB)
  const [prompt, setPrompt] = useState(lastPrompt)
  const [agents, setAgents] = useState<DebateAgent[]>([])
  // Dynamic seat list (2-4 participant ids). Seeded from the two settings
  // defaults; not persisted — per-run seating lives here like sideA/sideB did.
  const [seats, setSeats] = useState<string[]>([sideA, sideB])
  const [synthesizerId, setSynthesizerId] = useState<string>(sideA)

  // Load the participants the user can actually use (keyed APIs + available CLIs).
  useEffect(() => {
    window.api.debate.agents().then((list) => {
      setAgents(list)
      const ids = new Set(list.map((p) => p.id))
      setSeats((prev) => {
        const kept = prev.filter((id) => ids.has(id))
        const fallback = list.map((p) => p.id).filter((id) => !kept.includes(id))
        const next = [...kept]
        while (next.length < MIN_SEATS && fallback.length) next.push(fallback.shift()!)
        return next.length ? next : prev
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the synthesizer valid as seats change (default back to seat 1).
  useEffect(() => {
    if (!seats.includes(synthesizerId)) setSynthesizerId(seats[0] ?? '')
  }, [seats, synthesizerId])

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
    if (!p || running || seats.length < MIN_SEATS) return
    startDebateState(p)
    window.api.debate.start(p, seats, synthesizerId).catch((err) => {
      useAppStore.getState().addDebateUpdate({
        type: 'error',
        text: `Failed to start debate: ${err instanceof Error ? err.message : String(err)}`
      })
      endDebate()
    })
  }

  const setSeat = (idx: number, id: string): void =>
    setSeats((prev) => prev.map((s, i) => (i === idx ? id : s)))

  const addSeat = (): void => {
    const used = new Set(seats)
    const next = agents.find((a) => !used.has(a.id))
    setSeats((prev) => [...prev, next?.id ?? agents[0]?.id ?? ''])
  }

  const removeSeat = (idx: number): void => setSeats((prev) => prev.filter((_, i) => i !== idx))

  const nameFor = (id: string): string => agents.find((a) => a.id === id)?.name ?? id

  const colorFor = (seat?: number): string =>
    seat == null ? 'text-green-400' : SEAT_COLORS[seat % SEAT_COLORS.length]

  const color = (u: DebateUpdate): string =>
    u.type === 'turn' ? colorFor(u.seat) : u.type === 'error' ? 'text-red-400' : 'text-green-400'

  // Label shown on each update block: participant name, or the meta-type.
  const label = (u: DebateUpdate): string =>
    u.type === 'turn' ? (u.name ?? `Seat ${(u.seat ?? 0) + 1}`) : u.type

  const notEnoughAgents = agents.length < MIN_SEATS
  const canStart = seats.length >= MIN_SEATS && seats.length <= MAX_SEATS && seats.every(Boolean)

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {seats.map((seatId, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <select
                className={`min-w-0 rounded border border-border bg-panel px-1.5 py-1 outline-none focus:border-accent disabled:opacity-50 ${colorFor(idx)}`}
                value={seatId}
                disabled={running}
                onChange={(e) => setSeat(idx, e.target.value)}
                title={`Participant ${idx + 1}`}
              >
                {agents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {seats.length > MIN_SEATS && !running && (
                <button
                  className="rounded border border-border px-1 text-gray-400 hover:bg-panel"
                  onClick={() => removeSeat(idx)}
                  title="Remove this participant"
                >
                  ×
                </button>
              )}
              {idx < seats.length - 1 && <span className="shrink-0 text-gray-500">vs</span>}
            </div>
          ))}
          {seats.length < MAX_SEATS && !running && (
            <button
              className="rounded border border-border px-2 py-1 text-gray-300 hover:bg-panel disabled:opacity-40"
              disabled={agents.length <= seats.length && agents.length === 0}
              onClick={addSeat}
              title="Add another participant (up to 4)"
            >
              + add participant
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-gray-500">Synthesizer</label>
          <select
            className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-1 outline-none focus:border-accent disabled:opacity-50"
            value={synthesizerId}
            disabled={running}
            onChange={(e) => setSynthesizerId(e.target.value)}
            title="Runs the final synthesis after approval"
          >
            {seats.map((id, idx) => (
              <option key={`${id}-${idx}`} value={id}>
                {nameFor(id)} (seat {idx + 1})
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
          {running ? (
            <button
              className="rounded bg-red-600 px-3 py-1 font-medium text-white"
              onClick={() => {
                window.api.debate.cancel()
                endDebate()
              }}
            >
              Stop
            </button>
          ) : (
            <button
              className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
              disabled={!canStart}
              onClick={start}
              title={!canStart ? 'Need 2-4 working models/APIs (add a key or install a CLI)' : ''}
            >
              Start
            </button>
          )}
          <button
            className="rounded border border-border px-3 py-1 text-gray-300 hover:bg-panel disabled:opacity-40"
            disabled={running}
            onClick={clear}
            title="Clear input and transcript"
          >
            Clear
          </button>
        </div>
        {notEnoughAgents && (
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
            {awaitText || 'Discussion complete. Approve to continue, or decline to keep the discussion only.'}
          </span>
          <button className="rounded bg-green-600 px-3 py-1 font-medium text-white" onClick={approve}>
            Approve
          </button>
          <button className="rounded border border-border px-3 py-1 text-gray-300" onClick={decline}>
            Decline
          </button>
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {updates.length === 0 && !running && (
          <div className="text-gray-500">
            Pick 2-4 models, choose a synthesizer, enter a task, Start. Round 1 every participant
            proposes; later rounds each critiques the others in turn; then the synthesizer writes
            up the final result. Only models/APIs you have working appear in the pickers.
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
