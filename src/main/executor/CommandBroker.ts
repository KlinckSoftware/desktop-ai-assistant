import { randomUUID } from 'node:crypto'
import { appState } from '../state'
import { CH, type AgentId, type PendingCommand, type CommandResult } from '../../shared/types'
import { decide, type ApprovalPolicy } from '../policy/ApprovalPolicy'
import { checkDangerous } from '../../shared/dangerousCommand'
import type { CommandExecutor } from './CommandExecutor'

// Default-deny gate between agents and the shell.
// Every parsed command becomes a PendingCommand the renderer must approve.
// The renderer may auto-approve (per-session "trust") but the decision still
// flows through here, so main never runs anything unapproved.
//
// Nonce proof-of-human-approval: each pending command is minted with a
// cryptographically random, single-use nonce (node:crypto randomUUID) that is
// sent to the renderer alongside the id. The renderer must echo that exact
// nonce back on approve/reject/confirmDangerous. Because the sequential id is
// guessable, a compromised renderer could otherwise call approve('cmd_7') for
// a command it never actually displayed to the human; requiring the nonce
// means the renderer has to have genuinely received that specific pending
// message before it can act on it. A mismatched or missing nonce is treated
// as a security event: nothing executes, the pending entry is removed (the
// nonce is consumed by construction, so it cannot be replayed), a warning is
// logged, and the caller (the model waiting on the proposal) is unblocked
// with a "blocked" result rather than left hanging forever.

interface Pending {
  command: string
  origin: AgentId
  sessionId: string
  nonce: string
  resolve: (output: string) => void
}

export class CommandBroker {
  private pending = new Map<string, Pending>()
  private seq = 0

  constructor(private executor: CommandExecutor) {}

  /** Propose a command for approval. Resolves with its output (or a rejection note). */
  propose(command: string, origin: AgentId, sessionId: string): Promise<string> {
    const id = `cmd_${++this.seq}`
    const nonce = randomUUID()
    const msg: PendingCommand = { id, command, origin, sessionId, nonce }
    appState.send(CH.cmdPending, msg)
    return new Promise((resolve) => {
      this.pending.set(id, { command, origin, sessionId, nonce, resolve })
    })
  }

  // Verify the caller's nonce matches the one minted for this pending id. On a
  // mismatch (or an id that already resolved) this blocks the action, removes
  // the pending entry so the nonce cannot be reused, logs a warning, and
  // resolves the original promise so the model is not left waiting forever.
  private verifyNonce(id: string, nonce: string, action: string): Pending | undefined {
    const p = this.pending.get(id)
    if (!p) return undefined
    if (p.nonce !== nonce) {
      this.pending.delete(id)
      console.warn(`[security] ${action}() nonce mismatch for command ${id} — refusing to execute`)
      appState.send(CH.cmdResult, {
        id,
        command: p.command,
        output: '[blocked: approval nonce mismatch]',
        exitInferred: false
      } satisfies CommandResult)
      p.resolve('[blocked: approval nonce mismatch]')
      return undefined
    }
    return p
  }

  async approve(id: string, nonce: string): Promise<void> {
    const p = this.verifyNonce(id, nonce, 'approve')
    if (!p) return
    this.pending.delete(id)
    // Defense in depth: enforce the dangerous denylist HERE, in main. The plain
    // approve path (incl. trusted-session auto-approve in the renderer) must
    // never silently run a dangerous command — those require confirmDangerous,
    // which only the explicit human-facing card invokes. A buggy/compromised
    // renderer calling approve() on a dangerous command is blocked.
    const danger = checkDangerous(p.command)
    if (danger.dangerous) {
      console.warn(`[security] approve() blocked dangerous command (needs explicit confirm): ${p.command}`)
      appState.send(CH.cmdResult, {
        id,
        command: p.command,
        output: `[blocked: dangerous command (${danger.reason}) needs explicit confirmation]`,
        exitInferred: false
      } satisfies CommandResult)
      p.resolve(`[blocked: dangerous command needs explicit confirmation]`)
      return
    }
    p.resolve(await this.exec(id, p.command, p.origin, p.sessionId))
  }

  /** Explicit run of a (typically dangerous) command — only the human approval
   *  card calls this, after showing the danger warning. */
  async confirmDangerous(id: string, nonce: string): Promise<void> {
    const p = this.verifyNonce(id, nonce, 'confirmDangerous')
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

  // Actually run an approved command and broadcast its result. A session with an
  // isolated worktree runs in that cwd (a one-off process), separate from the
  // shared interactive pty which stays on the project root and mirrors to the
  // terminal pane.
  private async exec(id: string, command: string, origin: AgentId, sessionId: string): Promise<string> {
    const root = appState.rootFor(sessionId)
    const output =
      root === appState.projectRoot
        ? await this.executor.run(command, origin, sessionId, id)
        : await this.executor.execOnce(command, root)
    appState.send(CH.cmdResult, { id, command, output, exitInferred: true } satisfies CommandResult)
    return output
  }

  reject(id: string, nonce: string): void {
    const p = this.verifyNonce(id, nonce, 'reject')
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
