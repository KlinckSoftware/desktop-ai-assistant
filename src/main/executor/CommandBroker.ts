import { appState } from '../state'
import { CH, type AgentId, type PendingCommand, type CommandResult } from '../../shared/types'
import type { CommandExecutor } from './CommandExecutor'

// Default-deny gate between agents and the shell.
// Every parsed command becomes a PendingCommand the renderer must approve.
// The renderer may auto-approve (per-session "trust") but the decision still
// flows through here, so main never runs anything unapproved.

interface Pending {
  command: string
  origin: AgentId
  sessionId: string
  resolve: (output: string) => void
}

export class CommandBroker {
  private pending = new Map<string, Pending>()
  private seq = 0

  constructor(private executor: CommandExecutor) {}

  /** Propose a command for approval. Resolves with its output (or a rejection note). */
  propose(command: string, origin: AgentId, sessionId: string): Promise<string> {
    const id = `cmd_${++this.seq}`
    const msg: PendingCommand = { id, command, origin, sessionId }
    appState.send(CH.cmdPending, msg)
    return new Promise((resolve) => {
      this.pending.set(id, { command, origin, sessionId, resolve })
    })
  }

  async approve(id: string): Promise<void> {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    const output = await this.executor.run(p.command, p.origin, p.sessionId, id)
    const result: CommandResult = { id, command: p.command, output, exitInferred: true }
    appState.send(CH.cmdResult, result)
    p.resolve(output)
  }

  reject(id: string): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    appState.send(CH.cmdResult, {
      id,
      command: p.command,
      output: '[rejected by user]',
      exitInferred: false
    } satisfies CommandResult)
    p.resolve('[command rejected by user]')
  }
}
