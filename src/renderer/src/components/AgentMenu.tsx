import { useEffect, useRef, useState } from 'react'
import type { AgentDef } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'
import { openAgent } from '../dock/agents'
import AgentsModal from './AgentsModal'
import AgentSetupModal from './AgentSetupModal'

// Top-bar agent launcher. Each pick opens a NEW agent instance as its own dock
// panel (drag/split as you like). Unavailable agents route to the setup window.
export default function AgentMenu(): JSX.Element {
  const agents = useAppStore((s) => s.agents)
  const [open, setOpen] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [setupAgent, setSetupAgent] = useState<AgentDef | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const launch = (a: AgentDef): void => {
    setOpen(false)
    if (a.available === false) setSetupAgent(a)
    else openAgent(a.id)
  }

  return (
    <div ref={ref} className="relative">
      <button
        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
        onClick={() => setOpen((o) => !o)}
      >
        ＋ Agent ▾
      </button>
      {open && (
        <div
          style={{ zIndex: Z.dropdown }}
          className="absolute left-0 top-full mt-1 w-52 rounded border border-border bg-panel py-1 text-xs shadow-xl"
        >
          <div className="px-3 py-1 text-[10px] uppercase text-gray-500">New agent</div>
          {agents.map((a) => (
            <button
              key={a.id}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg"
              onClick={() => launch(a)}
            >
              <span className={a.available ? 'text-green-400' : 'text-gray-600'}>●</span>
              {a.name}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            className="block w-full px-3 py-1.5 text-left text-gray-400 hover:bg-bg"
            onClick={() => {
              setOpen(false)
              setShowManage(true)
            }}
          >
            Add / manage agents…
          </button>
        </div>
      )}

      {showManage && <AgentsModal onClose={() => setShowManage(false)} />}
      {setupAgent && (
        <AgentSetupModal
          agent={setupAgent}
          onClose={() => setSetupAgent(null)}
          onReady={(a) => openAgent(a.id)}
        />
      )}
    </div>
  )
}
