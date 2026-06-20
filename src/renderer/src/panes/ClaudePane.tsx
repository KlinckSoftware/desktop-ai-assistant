import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useAppStore } from '../store/appStore'

// Interactive Claude Code CLI session, rendered with xterm.js.
// Keystrokes go to the real pty; output streams back. This is a genuine
// interactive terminal — the user can drive Claude directly.
export default function ClaudePane(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const activeClaude = useAppStore((s) => s.activeClaude)
  const addClaudeSession = useAppStore((s) => s.addClaudeSession)
  const sessions = useAppStore((s) => s.claudeSessions)

  const initRef = useRef(false)

  // Ensure at least one session exists.
  useEffect(() => {
    if (sessions.length === 0 && !initRef.current) {
      initRef.current = true
      const id = `claude-${Date.now()}`
      window.api.claude.newSession(id).then(() => {
        addClaudeSession({ id, label: 'Session 1' })
      }).catch(() => {
        initRef.current = false // reset on failure
      })
    }
  }, [sessions.length, addClaudeSession])

  useEffect(() => {
    if (!ref.current || !activeClaude) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
      cursorBlink: true,
      scrollback: 10000
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Make URLs (e.g. the /login OAuth link) clickable → open in the browser.
    term.loadAddon(new WebLinksAddon((_e, uri) => window.api.openExternal(uri)))
    term.open(ref.current)
    fit.fit()
    termRef.current = term

    const sessionId = activeClaude
    window.api.claude.resize(sessionId, term.cols, term.rows)

    // Clipboard: Ctrl/Cmd+V (and Ctrl+Shift+V) paste into the pty; Ctrl+Shift+C
    // copies the selection. (Ctrl+C stays SIGINT for the shell.)
    term.attachCustomKeyEventHandler((e): boolean => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'v' || e.key === 'V')) {
        window.api.clipboard.read().then((t) => t && window.api.claude.write(sessionId, t))
        return false
      }
      if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const sel = term.getSelection()
        if (sel) window.api.clipboard.write(sel)
        return false
      }
      return true
    })

    const offStream = window.api.claude.onStream((sid, data) => {
      if (sid === sessionId) term.write(data)
    })
    const dataDisp = term.onData((data) => window.api.claude.write(sessionId, data))

    const onResize = (): void => {
      fit.fit()
      window.api.claude.resize(sessionId, term.cols, term.rows)
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
  }, [activeClaude])

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold text-claude">● Claude Code</span>
        <span className="text-gray-500">{activeClaude || 'starting…'}</span>
      </div>
      <div ref={ref} className="flex-1 overflow-hidden p-1" />
    </div>
  )
}
