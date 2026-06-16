import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { appState } from '../state'
import { CH } from '../../shared/types'
import { CommandExtractor } from '../executor/parser'
import type { CommandBroker } from '../executor/CommandBroker'

// Spawns `claude` (the Claude Code CLI) as a persistent interactive pty per session.
// Raw output streams to xterm.js in the renderer. We also sniff the output for
// ```bash run``` blocks and route them through the approval broker; results are
// typed back into the same interactive session.

interface Session {
  proc: IPty
  extractor: CommandExtractor
  buffer: string
}

const IS_WIN = process.platform === 'win32'
const CLAUDE_BIN = IS_WIN ? 'claude.cmd' : 'claude'

export class ClaudeProcessManager {
  private sessions = new Map<string, Session>()

  constructor(private broker: CommandBroker) {}

  spawn(sessionId: string, cwd: string): void {
    if (this.sessions.has(sessionId)) return

    const proc = pty.spawn(CLAUDE_BIN, [], {
      name: 'xterm-color',
      cols: 200,
      rows: 50,
      cwd,
      env: process.env as Record<string, string>
    })

    const session: Session = { proc, extractor: new CommandExtractor(), buffer: '' }
    this.sessions.set(sessionId, session)

    proc.onData((data) => {
      appState.send(CH.claudeStream, sessionId, data)
      session.buffer += data
      // Keep the buffer bounded.
      if (session.buffer.length > 200_000) {
        session.buffer = session.buffer.slice(-100_000)
      }
      this.routeCommands(sessionId, session)
    })

    proc.onExit(({ exitCode }) => {
      appState.send(CH.claudeStream, sessionId, `\r\n[claude session exited: ${exitCode}]\r\n`)
      this.sessions.delete(sessionId)
    })
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

  private routeCommands(sessionId: string, session: Session): void {
    const cmds = session.extractor.extract(session.buffer)
    for (const cmd of cmds) {
      this.broker.propose(cmd, 'claude', sessionId).then((output) => {
        this.send(sessionId, `Command output:\n\`\`\`\n${output}\n\`\`\``)
      })
    }
  }
}
