import { describe, it, expect, vi, beforeEach } from 'vitest'

// state.send broadcasts to a (possibly absent) window — stub it out. rootFor is
// controllable per-test: when it returns projectRoot, exec() uses the shared pty
// (executor.run); a different root routes to a one-off executor.execOnce(cwd).
const state = vi.hoisted(() => ({ rootFor: (_s?: string) => '/root' }))
vi.mock('../state', () => ({
  appState: { send: vi.fn(), projectRoot: '/root', rootFor: (s?: string) => state.rootFor(s) }
}))

import { CommandBroker } from './CommandBroker'
import type { CommandExecutor } from './CommandExecutor'

function makeBroker() {
  const run = vi.fn(async (cmd: string) => `ran: ${cmd}`)
  const execOnce = vi.fn(async (cmd: string, cwd: string) => `ranIn(${cwd}): ${cmd}`)
  const broker = new CommandBroker({ run, execOnce } as unknown as CommandExecutor)
  return { broker, run, execOnce }
}

describe('CommandBroker.runWithPolicy', () => {
  let broker: CommandBroker
  let run: ReturnType<typeof vi.fn>
  let execOnce: ReturnType<typeof vi.fn>
  beforeEach(() => {
    state.rootFor = () => '/root' // default: no isolation → shared pty
    ;({ broker, run, execOnce } = makeBroker())
  })

  it('autonomous: executes an allowlisted, safe command', async () => {
    const out = await broker.runWithPolicy('ls -la', 'api', 's', { mode: 'autonomous', allow: ['run_command'] })
    expect(out).toBe('ran: ls -la')
    expect(run).toHaveBeenCalledOnce()
  })

  it('isolation: a session with a worktree root runs in that cwd via execOnce', async () => {
    state.rootFor = (s) => (s === 'wt' ? '/root/.dai-trees/agent-wt' : '/root')
    const out = await broker.runWithPolicy('ls', 'api', 'wt', { mode: 'autonomous', allow: ['run_command'] })
    expect(out).toBe('ranIn(/root/.dai-trees/agent-wt): ls')
    expect(execOnce).toHaveBeenCalledOnce()
    expect(run).not.toHaveBeenCalled()
  })

  it('autonomous: blocks a dangerous command in MAIN (never reaches the executor)', async () => {
    const out = await broker.runWithPolicy('rm -rf /', 'api', 's', { mode: 'autonomous', allow: ['run_command'] })
    expect(out).toMatch(/blocked by policy/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('autonomous: blocks the process-kill hole (agent cannot kill its host)', async () => {
    const out = await broker.runWithPolicy('taskkill /F /IM electron.exe', 'api', 's', {
      mode: 'autonomous',
      allow: ['run_command']
    })
    expect(out).toMatch(/blocked by policy/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('autonomous: blocks a command when run_command is not allowlisted', async () => {
    const out = await broker.runWithPolicy('ls', 'api', 's', { mode: 'autonomous', allow: ['read_file'] })
    expect(out).toMatch(/blocked by policy/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('dry-run: reports intent without executing', async () => {
    const out = await broker.runWithPolicy('npm test', 'api', 's', { mode: 'dryrun', allow: ['run_command'] })
    expect(out).toBe('[dry-run] would run: npm test')
    expect(run).not.toHaveBeenCalled()
  })

  it('interactive: falls back to a pending approval card (does not auto-run)', async () => {
    // never resolves on its own — it's awaiting a human approve()
    let resolved = false
    void broker.runWithPolicy('ls', 'api', 's', { mode: 'interactive' }).then(() => (resolved = true))
    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('CommandBroker interactive approve (main-side danger gate)', () => {
  let broker: CommandBroker
  let run: ReturnType<typeof vi.fn>
  beforeEach(() => {
    ;({ broker, run } = makeBroker())
  })

  it('plain approve() runs a safe command', async () => {
    const p = broker.propose('ls -la', 'claude', 's')
    await broker.approve('cmd_1')
    expect(await p).toBe('ran: ls -la')
  })

  it('plain approve() BLOCKS a dangerous command in main (renderer cannot bypass)', async () => {
    const p = broker.propose('git push origin main', 'claude', 's')
    await broker.approve('cmd_1')
    expect(await p).toMatch(/blocked: dangerous/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('confirmDangerous() runs the dangerous command (explicit human path)', async () => {
    const p = broker.propose('git push origin main', 'claude', 's')
    await broker.confirmDangerous('cmd_1')
    expect(await p).toBe('ran: git push origin main')
    expect(run).toHaveBeenCalledOnce()
  })
})
