import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useAppStore } from '../store/appStore'

// Interactive terminal for the active CLI-agent session (Claude, Gemini CLI,
// Aider, …). Keystrokes go to the real pty; output streams back.
export default function AgentPane(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const activeSession = useAppStore((s) => s.activeSession)
  const sessions = useAppStore((s) => s.sessions)
  const agents = useAppStore((s) => s.agents)
  const addSession = useAppStore((s) => s.addSession)
  const initRef = useRef(false)

  const session = sessions.find((s) => s.id === activeSession)
  const agentName = agents.find((a) => a.id === session?.agentId)?.name ?? session?.agentId

  // Ensure at least one session exists (default to Claude).
  useEffect(() => {
    if (sessions.length === 0 && !initRef.current) {
      initRef.current = true
      const id = `claude-${Date.now()}`
      window.api.agent
        .newSession(id, 'claude')
        .then(() => addSession({ id, agentId: 'claude', label: 'Claude 1', cwd: '' }))
        .catch(() => {
          initRef.current = false
        })
    }
  }, [sessions.length, addSession])

  useEffect(() => {
    if (!ref.current || !activeSession) return
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
      cursorBlink: true,
      scrollback: 10000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))
    term.open(ref.current)
    fit.fit()

    const sessionId = activeSession
    window.api.agent.resize(sessionId, term.cols, term.rows)

    term.attachCustomKeyEventHandler((e): boolean => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'v' || e.key === 'V')) {
        window.api.clipboard.read().then((t) => t && window.api.agent.write(sessionId, t))
        return false
      }
      if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const sel = term.getSelection()
        if (sel) window.api.clipboard.write(sel)
        return false
      }
      return true
    })

    const offStream = window.api.agent.onStream((sid, data) => {
      if (sid === sessionId) term.write(data)
    })
    const dataDisp = term.onData((data) => window.api.agent.write(sessionId, data))

    const onResize = (): void => {
      fit.fit()
      window.api.agent.resize(sessionId, term.cols, term.rows)
    }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(ref.current)

    return () => {
      offStream()
      dataDisp.dispose()
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      term.dispose()
    }
  }, [activeSession])

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold text-claude">● {agentName || 'Agent'}</span>
        <span className="text-gray-500">{session?.label || 'starting…'}</span>
      </div>
      <div ref={ref} className="flex-1 overflow-hidden p-1" />
    </div>
  )
}
