import { useEffect, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

// One terminal per agent instance. The pty session is created BEFORE the panel
// is added (see dock/agents.ts), so here we just bind xterm to params.sessionId
// and kill the session when the panel closes (unmount).
export default function AgentPane(props: IDockviewPanelProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const sessionId = (props.params as { sessionId: string }).sessionId

  useEffect(() => {
    if (!ref.current) return
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
      window.api.agent.kill(sessionId) // closing the panel ends the session
    }
  }, [sessionId])

  return <div ref={ref} className="h-full w-full overflow-hidden bg-bg p-1" />
}
