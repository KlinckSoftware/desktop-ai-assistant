import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { appState } from '../state'
import { CH } from '../../shared/types'
import { resolveBin, cleanClaudeEnv } from '../util/resolveBin'

// Spawns `claude` (the Claude Code CLI) as a persistent interactive pty per
// session and streams raw output to xterm.js. Claude runs its own tools, so we
// do NOT sniff/buffer its output — doing so meant a full-buffer regex on every
// frame of an animated TUI (constant CPU + GC churn). Output is a pure passthrough.

interface Session {
  proc: IPty
}

const CLAUDE_BIN = resolveBin('claude')

export class ClaudeProcessManager {
  private sessions = new Map<string, Session>()

  spawn(sessionId: string, cwd: string): void {
    if (this.sessions.has(sessionId)) return

    const proc = pty.spawn(CLAUDE_BIN, [], {
      name: 'xterm-color',
      cols: 200,
      rows: 50,
      cwd,
      env: cleanClaudeEnv()
    })

    this.sessions.set(sessionId, { proc })

    proc.onData((data) => {
      appState.send(CH.claudeStream, sessionId, data)
    })

    proc.onExit(({ exitCode }) => {
      console.log(`[claude] session ${sessionId} exited code=${exitCode}`)
      appState.send(CH.claudeStream, sessionId, `\r\n[claude session exited: ${exitCode}]\r\n`)
      this.sessions.delete(sessionId)
    })
    console.log(`[claude] spawned ${CLAUDE_BIN} (session ${sessionId})`)
  }

  send(sessionId: string, text: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) throw new Error(`No claude session: ${sessionId}`)
    s.proc.write(text + '\r')
  }

  /** Raw keystrokes from the user typing into the Claude xterm pane. */
  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.proc.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    try {
      this.sessions.get(sessionId)?.proc.resize(cols, rows)
    } catch {
      /* ignore */
    }
  }

  kill(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s) return
    s.proc.kill()
    this.sessions.delete(sessionId)
  }

  killAll(): void {
    for (const s of this.sessions.values()) s.proc.kill()
    this.sessions.clear()
  }
}
