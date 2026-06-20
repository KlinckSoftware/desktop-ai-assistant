import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

// Sessions across all CLI agents. "New" opens an agent picker; multiple
// sessions of the same agent are allowed.
export default function SessionSidebar(): JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const agents = useAppStore((s) => s.agents)
  const active = useAppStore((s) => s.activeSession)
  const addSession = useAppStore((s) => s.addSession)
  const setActive = useAppStore((s) => s.setActiveSession)
  const removeSession = useAppStore((s) => s.removeSession)
  const [pickerOpen, setPickerOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  const agentName = (id: string): string => agents.find((a) => a.id === id)?.name ?? id

  const newSession = async (agentId: string): Promise<void> => {
    setPickerOpen(false)
    const id = `${agentId}-${Date.now()}`
    const n = sessions.filter((s) => s.agentId === agentId).length + 1
    try {
      await window.api.agent.newSession(id, agentId)
      addSession({ id, agentId, label: `${agentName(agentId)} ${n}`, cwd: '' })
    } catch (e) {
      console.error('new session failed', e)
    }
  }

  const kill = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    await window.api.agent.kill(id).catch(() => {})
    removeSession(id)
  }

  return (
    <div ref={ref} className="relative flex h-full flex-col bg-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold text-gray-300">Sessions</span>
        <button
          onClick={() => setPickerOpen((o) => !o)}
          className="rounded px-1.5 py-0.5 hover:bg-bg"
          title="New session"
          aria-label="New session"
        >
          +
        </button>
      </div>
      {pickerOpen && (
        <div
          style={{ zIndex: Z.dropdown }}
          className="absolute right-2 top-8 w-44 rounded border border-border bg-panel py-1 text-xs shadow-xl"
        >
          <div className="px-3 py-1 text-[10px] uppercase text-gray-500">New session</div>
          {agents.map((a) => (
            <button
              key={a.id}
              className="block w-full px-3 py-1.5 text-left hover:bg-bg"
              onClick={() => newSession(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`group flex cursor-pointer items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
              active === s.id ? 'bg-claude/10 text-claude' : 'text-gray-400 hover:bg-bg hover:text-gray-200'
            }`}
          >
            <span className="truncate">{s.label}</span>
            <button
              onClick={(e) => kill(e, s.id)}
              className="invisible text-gray-500 hover:text-red-400 group-hover:visible"
              title="Close session"
              aria-label={`Close ${s.label}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
