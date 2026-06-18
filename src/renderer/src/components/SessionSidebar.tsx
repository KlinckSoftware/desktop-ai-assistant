import { useAppStore } from '../store/appStore'

export default function SessionSidebar(): JSX.Element {
  const sessions = useAppStore((s) => s.claudeSessions)
  const activeClaude = useAppStore((s) => s.activeClaude)
  const addClaudeSession = useAppStore((s) => s.addClaudeSession)
  const setActiveClaude = useAppStore((s) => s.setActiveClaude)
  const removeClaudeSession = useAppStore((s) => s.removeClaudeSession)

  const handleNewSession = async () => {
    const id = `claude-${Date.now()}`
    try {
      await window.api.claude.newSession(id)
      addClaudeSession({ id, label: `Session ${sessions.length + 1}` })
    } catch (e) {
      console.error('Failed to create new session', e)
    }
  }

  const handleKill = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await window.api.claude.kill(id)
      removeClaudeSession(id)
    } catch (e) {
      console.error('Failed to kill session', e)
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold text-gray-300">Sessions</span>
        <button
          onClick={handleNewSession}
          className="rounded px-1.5 py-0.5 hover:bg-bg"
          title="New Session"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveClaude(s.id)}
            className={`group flex cursor-pointer items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
              activeClaude === s.id
                ? 'bg-claude/10 text-claude'
                : 'text-gray-400 hover:bg-bg hover:text-gray-200'
            }`}
          >
            <span className="truncate">{s.label}</span>
            <button
              onClick={(e) => handleKill(e, s.id)}
              className="invisible text-gray-500 hover:text-red-400 group-hover:visible"
              title="Close session"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
