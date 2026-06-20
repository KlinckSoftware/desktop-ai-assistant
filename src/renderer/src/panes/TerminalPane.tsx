import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'

// Mirror of the shared command-executor shell. Shows output from approved
// agent commands and accepts direct user input.
export default function TerminalPane(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

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
      <div className="border-b border-border px-3 py-1.5 text-xs font-semibold text-accent">
        ▸ Terminal
      </div>
      <div ref={ref} className="flex-1 overflow-hidden p-1" />
    </div>
  )
}
