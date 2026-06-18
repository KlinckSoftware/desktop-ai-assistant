import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { appState } from '../state'
import { CH, type AgentId } from '../../shared/types'
import { resolveBin } from '../util/resolveBin'

// Runs approved shell commands in a single persistent pty and mirrors output to
// the terminal pane. Per-command output is captured using a unique sentinel
// echoed after the command. The backing shell is user-selectable.

interface QueueItem {
  id: string
  command: string
  origin: AgentId
  sessionId: string
  resolve: (output: string) => void
}

const IS_WIN = process.platform === 'win32'

export type ShellKind = 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh'

interface ShellConfig {
  path: string
  args: string[]
  sep: string // command separator for chaining the sentinel echo
}

function shellConfig(kind: ShellKind): ShellConfig {
  switch (kind) {
    case 'powershell':
      return { path: resolveBin('powershell'), args: ['-NoLogo', '-NoProfile'], sep: ';' }
    case 'pwsh':
      return { path: resolveBin('pwsh'), args: ['-NoLogo', '-NoProfile'], sep: ';' }
    case 'cmd':
      return { path: resolveBin('cmd'), args: [], sep: '&' } // cmd chains with &, not ;
    case 'bash':
      return { path: resolveBin('bash'), args: [], sep: ';' }
    case 'zsh':
      return { path: resolveBin('zsh'), args: [], sep: ';' }
    case 'default':
    default:
      return IS_WIN
        ? { path: resolveBin('powershell'), args: ['-NoLogo', '-NoProfile'], sep: ';' }
        : { path: process.env.SHELL || resolveBin('bash'), args: [], sep: ';' }
  }
}

export class CommandExecutor {
  private shell!: IPty
  private sep = ';'
  private queue: QueueItem[] = []
  private active: QueueItem | null = null
  private capture = ''
  private sentinel = ''
  private seq = 0
  private timer: NodeJS.Timeout | null = null

  constructor(private cwd: string) {
    this.spawnShell()
  }

  private spawnShell(): void {
    const cfg = shellConfig(appState.settings.terminalShell)
    this.sep = cfg.sep
    this.shell = pty.spawn(cfg.path, cfg.args, {
      name: 'xterm-color',
      cols: 200,
      rows: 50,
      cwd: this.cwd,
      env: process.env as Record<string, string>
    })

    this.shell.onData((data) => {
      appState.send(CH.terminalOutput, data)
      if (this.active) {
        this.capture += data
        if (this.sentinel && this.capture.includes(this.sentinel)) this.finishActive()
      }
    })

    this.shell.onExit(() => {
      if (this.active) this.finishActive(true)
      while (this.queue.length) this.queue.shift()!.resolve('[shell exited]')
    })
  }

  /** Kill the current shell and start a fresh one with the current setting. */
  respawn(): void {
    if (this.active) this.finishActive(true)
    while (this.queue.length) this.queue.shift()!.resolve('[shell restarted]')
    try {
      this.shell.kill()
    } catch {
      /* ignore */
    }
    this.spawnShell()
    appState.send(CH.terminalOutput, `\r\n[terminal: switched to ${appState.settings.terminalShell} shell]\r\n`)
  }

  writeRaw(data: string): void {
    this.shell.write(data)
  }

  resize(cols: number, rows: number): void {
    try {
      this.shell.resize(cols, rows)
    } catch {
      /* ignore */
    }
  }

  run(command: string, origin: AgentId, sessionId: string, id: string): Promise<string> {
    return new Promise((resolve) => {
      this.queue.push({ id, command, origin, sessionId, resolve })
      this.pump()
    })
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return
    this.active = this.queue.shift()!
    this.capture = ''
    this.sentinel = `__DAI_DONE_${++this.seq}__`
    this.shell.write(`${this.active.command} ${this.sep} echo ${this.sentinel}\r`)
    this.timer = setTimeout(() => this.finishActive(true), 120_000)
  }

  private finishActive(timedOut = false): void {
    if (!this.active) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const item = this.active
    this.active = null

    let output = this.capture
    const sIdx = output.indexOf(this.sentinel)
    if (sIdx >= 0) output = output.slice(0, sIdx)
    output = output.trimEnd()
    if (timedOut) output += '\n[executor: timed out waiting for completion]'

    item.resolve(output)
    this.pump()
  }
}
