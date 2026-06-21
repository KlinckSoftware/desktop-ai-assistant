import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { useAppStore } from '../store/appStore'

const SHELL_LABELS: Record<string, string> = {
  default: 'Default',
  powershell: 'PowerShell',
  pwsh: 'PowerShell 7',
  cmd: 'cmd',
  bash: 'bash',
  zsh: 'zsh'
}
const SHELLS = ['default', 'powershell', 'pwsh', 'cmd', 'bash', 'zsh'] as const

// Mirror of the shared command-executor shell. Shows output from approved
// agent commands and accepts direct user input.
export default function TerminalPane(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const terminalShell = useAppStore((s) => s.terminalShell)
  const setTerminalShell = useAppStore((s) => s.setTerminalShell)

  // Switch the backing shell (main respawns the executor pty on change).
  const onShell = (s: typeof terminalShell): void => {
    setTerminalShell(s)
    window.api.settings.set({ terminalShell: s })
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

    window.api.terminal.resize(term.cols, term.rows)
    const offOutput = window.api.terminal.onOutput((data) => term.write(data))
    const dataDisp = term.onData((data) => window.api.terminal.input(data))

    // Ctrl/Cmd+V paste; Ctrl+Shift+C copy selection.
    term.attachCustomKeyEventHandler((e): boolean => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'v' || e.key === 'V')) {
        window.api.clipboard.read().then((t) => t && window.api.terminal.input(t))
        return false
      }
      if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        const sel = term.getSelection()
        if (sel) window.api.clipboard.write(sel)
        return false
      }
      return true
    })

    const onResize = (): void => {
      fit.fit()
      window.api.terminal.resize(term.cols, term.rows)
    }
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(onResize)
    ro.observe(ref.current)

    return () => {
      offOutput()
      dataDisp.dispose()
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      term.dispose()
    }
  }, [])

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold text-accent">▸ Terminal</span>
        <select
          className="rounded border border-border bg-panel px-1.5 py-0.5 text-[11px] outline-none focus:border-accent"
          value={terminalShell}
          onChange={(e) => onShell(e.target.value as typeof terminalShell)}
          title="Switch the shell (restarts the terminal)"
        >
          {SHELLS.map((s) => (
            <option key={s} value={s}>
              {SHELL_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div ref={ref} className="flex-1 overflow-hidden p-1" />
    </div>
  )
}
