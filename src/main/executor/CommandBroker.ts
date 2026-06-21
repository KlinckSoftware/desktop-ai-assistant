import { appState } from '../state'
import { CH, type AgentId, type PendingCommand, type CommandResult } from '../../shared/types'
import { decide, type ApprovalPolicy } from '../policy/ApprovalPolicy'
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
    p.resolve(await this.exec(id, p.command, p.origin, p.sessionId))
  }

  // Run a command under an ApprovalPolicy — the MAIN-side gate for unattended
  // (autonomous) execution where there is no human approval card. Dangerous or
  // non-allowlisted commands are blocked here and logged; the caller continues.
  async runWithPolicy(
    command: string,
    origin: AgentId,
    sessionId: string,
    policy: ApprovalPolicy
  ): Promise<string> {
    const d = decide(policy, 'run_command', command)
    switch (d.action) {
      case 'interactive':
        return this.propose(command, origin, sessionId)
      case 'dryrun':
        return `[dry-run] would run: ${command}`
      case 'block':
        console.warn(`[policy] blocked command: ${command} — ${d.reason}`)
        return `[blocked by policy: ${d.reason}]`
      case 'run':
        return this.exec(`cmd_auto_${++this.seq}`, command, origin, sessionId)
    }
  }

  // Actually run an approved command and broadcast its result.
  private async exec(id: string, command: string, origin: AgentId, sessionId: string): Promise<string> {
    const output = await this.executor.run(command, origin, sessionId, id)
    appState.send(CH.cmdResult, { id, command, output, exitInferred: true } satisfies CommandResult)
    return output
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
