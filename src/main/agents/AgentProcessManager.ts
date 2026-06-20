import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { appState } from '../state'
import { CH, type AgentDef } from '../../shared/types'
import { resolveBin, cleanClaudeEnv } from '../util/resolveBin'

// Spawns any registered CLI agent as a persistent interactive pty per session
// and streams raw output to xterm.js. Output is a pure passthrough (no buffering
// /regex — that caused CPU/GC churn with animated TUIs).
interface Session {
  proc: IPty
  agentId: string
}

export class AgentProcessManager {
  private sessions = new Map<string, Session>()

  spawn(sessionId: string, def: AgentDef, cwd: string): void {
    if (this.sessions.has(sessionId)) return

    const bin = resolveBin(def.command)
    const proc = pty.spawn(bin, def.args, {
      name: 'xterm-color',
      cols: 200,
      rows: 50,
      cwd,
      // cleanClaudeEnv strips harness/auth env so nested AI CLIs use their own
      // login; per-agent env overrides layer on top.
      env: { ...cleanClaudeEnv(), ...(def.env ?? {}) }
    })

    this.sessions.set(sessionId, { proc, agentId: def.id })

    proc.onData((data) => appState.send(CH.agentStream, sessionId, data))
    proc.onExit(({ exitCode }) => {
      console.log(`[agent] ${def.id} session ${sessionId} exited code=${exitCode}`)
      appState.send(CH.agentStream, sessionId, `\r\n[${def.name} exited: ${exitCode}]\r\n`)
      this.sessions.delete(sessionId)
    })
    console.log(`[agent] spawned ${def.id} (${bin}) session ${sessionId}`)
  }

  /** Submit a line (text + Enter). */
  send(sessionId: string, text: string): void {
    this.sessions.get(sessionId)?.proc.write(text + '\r')
  }

  /** Raw keystrokes from the xterm pane. */
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
