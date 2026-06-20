import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { focusPanel } from '../dock/dockApi'

const KIND: Record<string, { label: string; cls: string }> = {
  cli: { label: 'CLI', cls: 'text-accent' },
  api: { label: 'API', cls: 'text-gemini' },
  gemini: { label: 'Gemini', cls: 'text-gemini' }
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

function tokens(chars: number): string {
  const t = Math.round(chars / 4) // rough heuristic, not a real tokenizer
  return t < 1000 ? `${t}` : `${(t / 1000).toFixed(1)}k`
}

// Cockpit dashboard: live fleet of open agents — kind, model, status, a rough
// output-token meter, and last activity. Click an entry to focus its panel.
export default function CockpitPanel(): JSX.Element {
  const fleet = useAppStore((s) => s.fleet)
  const [now, setNow] = useState(() => Date.now())

  // Re-render every 3s so the "last active" column stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3000)
    return () => clearInterval(t)
  }, [])

  const agents = Object.values(fleet).sort((a, b) => b.lastTs - a.lastTs)

  return (
    <div className="flex h-full flex-col bg-bg text-xs">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-semibold text-accent">Cockpit</span>
        <span className="text-[10px] text-gray-600">{agents.length} agent(s)</span>
      </div>
      {agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-gray-600">
          No agents open. Add one with ＋ Agent ▾.
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {agents.map((a) => {
            const k = KIND[a.kind] ?? { label: a.kind, cls: 'text-gray-400' }
            return (
              <button
                key={a.id}
                className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 text-left hover:bg-panel"
                onClick={() => focusPanel(a.id)}
                title="Focus this agent's panel"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    a.status === 'busy' ? 'animate-pulse bg-amber-400' : 'bg-gray-600'
                  }`}
                  title={a.status}
                />
                <span className="flex-1 truncate">
                  <span className="font-medium text-gray-200">{a.name}</span>
                  <span className={`ml-1.5 text-[10px] ${k.cls}`}>{k.label}</span>
                  {a.model && <span className="ml-1 truncate text-[10px] text-gray-500">{a.model}</span>}
                </span>
                <span className="shrink-0 text-[10px] text-gray-500" title="≈ output tokens (chars ÷ 4)">
                  ~{tokens(a.chars)}
                </span>
                <span className="w-14 shrink-0 text-right text-[10px] text-gray-600">{ago(a.lastTs, now)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
