import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import { appState } from '../state'
import { CH, type AgentId } from '../../shared/types'

// Runs approved shell commands in a single persistent pty.
// Output is mirrored to the terminal pane AND captured per-command using a
// unique sentinel echoed after each command (replaces the plan's fragile 3s wait).
//
// Commands are queued and run one at a time so captured output never interleaves.

interface QueueItem {
  id: string
  command: string
  origin: AgentId
  sessionId: string
  resolve: (output: string) => void
}

const IS_WIN = process.platform === 'win32'

export class CommandExecutor {
  private shell: IPty
  private queue: QueueItem[] = []
  private active: QueueItem | null = null
  private capture = ''
  private sentinel = ''
  private seq = 0
  private timer: NodeJS.Timeout | null = null

  constructor(cwd: string) {
    const shellPath = IS_WIN ? 'powershell.exe' : process.env.SHELL || 'bash'
    const shellArgs = IS_WIN ? ['-NoLogo', '-NoProfile'] : []
    this.shell = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-color',
      cols: 200,
      rows: 50,
      cwd,
      env: process.env as Record<string, string>
    })

    this.shell.onData((data) => {
      // Always mirror raw output to the terminal pane.
      appState.send(CH.terminalOutput, data)
      if (this.active) {
        this.capture += data
        if (this.sentinel && this.capture.includes(this.sentinel)) {
          this.finishActive()
        }
      }
    })

    this.shell.onExit(() => {
      // If the shell dies, fail any in-flight/queued work gracefully.
      if (this.active) this.finishActive(true)
      while (this.queue.length) {
        const item = this.queue.shift()!
        item.resolve('[shell exited]')
      }
    })
  }

  /** User typed directly into the terminal pane. */
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

  /** Queue an approved command; resolves with captured stdout/stderr text. */
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

    // Echo the sentinel after the command so we know it finished.
    // PowerShell and bash both accept `;` sequencing.
    const line = `${this.active.command} ; echo ${this.sentinel}\r`
    this.shell.write(line)

    // Safety timeout — never hang forever waiting for a sentinel.
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

    // Strip the echoed command line and the sentinel from captured output.
    let output = this.capture
    const sIdx = output.indexOf(this.sentinel)
    if (sIdx >= 0) output = output.slice(0, sIdx)
    output = output.trimEnd()
    if (timedOut) output += '\n[executor: timed out waiting for completion]'

    item.resolve(output)
    this.pump()
  }
}
