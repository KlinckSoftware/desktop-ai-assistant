import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useAppStore } from '../store/appStore'
import { buildCliContext } from '../utils/context'
import HandoffChip from '../components/HandoffChip'

// One terminal per agent instance. The pty session is created BEFORE the panel
// is added (see dock/agents.ts), so here we just bind xterm to params.sessionId
// and kill the session when the panel closes (unmount).
export default function AgentPane(props: IDockviewPanelProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { sessionId, agentId } = props.params as { sessionId: string; agentId: string }
  const poolSize = useAppStore((s) => s.contextFiles.size)
  const repoMap = useAppStore((s) => s.repoMapInContext)
  const hasContext = poolSize > 0 || repoMap

  // Register with the cockpit fleet while this terminal is open.
  useEffect(() => {
    const name = useAppStore.getState().agents.find((a) => a.id === agentId)?.name ?? agentId
    useAppStore.getState().registerFleet({
      id: sessionId,
      name,
      kind: 'cli',
      status: 'idle',
      chars: 0,
      lastTs: Date.now()
    })
    return () => useAppStore.getState().removeFleet(sessionId)
  }, [sessionId, agentId])

  // Write the shared context (pooled paths + repo map) into the agent's prompt.
  // No trailing newline — the user reviews and submits it themselves.
  const inject = async (): Promise<void> => {
    const st = useAppStore.getState()
    const text = await buildCliContext([...st.contextFiles], st.repoMapInContext, st.projectRoot)
    if (text) window.api.agent.write(sessionId, text)
  }

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
      if (sid === sessionId) {
        term.write(data)
        useAppStore.getState().bumpFleet(sessionId, data.length)
      }
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

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="flex items-center justify-end border-b border-border px-2 py-1">
        <button
          className={`rounded border px-2 py-0.5 text-[10px] ${
            hasContext
              ? 'border-gemini text-gemini hover:bg-gemini/15'
              : 'border-border text-gray-600'
          }`}
          onClick={inject}
          disabled={!hasContext}
          title="Paste shared context (pooled files + repo map) into this agent's prompt"
        >
          ◆ Inject context{poolSize > 0 ? ` (${poolSize})` : repoMap ? ' (map)' : ''}
        </button>
      </div>
      <HandoffChip self={sessionId} insertLabel="inject" onInsert={(t) => window.api.agent.write(sessionId, t)} />
      <div ref={ref} className="flex-1 overflow-hidden p-1" />
    </div>
  )
}
