import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import http from 'http'
import type { ServerResponse } from 'http'
import type { AddressInfo } from 'net'

// End-to-end, headless: drive real pipeline runs through RunManager →
// PipelineRunner → OpenAIClient (real SSE tool loop) → execTool → FileEditBroker
// → a real git worktree, with ONLY the model faked by a local scriptable SSE
// server. No GUI. Covers: an isolated edit + merge, dry-run, conditional skip,
// and in-flight cancel.

// --- mock the electron-touching singletons ---
const st = vi.hoisted(() => {
  const roots = new Map<string, string>()
  return {
    appState: {
      projectRoot: '',
      mainWindow: null as unknown,
      settings: {
        isolateAgents: true,
        costCap: 0,
        allowProtectedWrites: false,
        pipelineAllowFullDefault: false,
        autonomousAllow: '',
        claudeModel: '',
        claudeEffort: ''
      },
      events: [] as unknown[][],
      send(ch: string, ...a: unknown[]) {
        this.events.push([ch, ...a])
      },
      setSessionRoot(id: string, r: string) {
        roots.set(id, r)
      },
      clearSessionRoot(id: string) {
        roots.delete(id)
      },
      rootFor(id?: string) {
        return (id && roots.get(id)) || this.projectRoot
      }
    }
  }
})
vi.mock('../state', () => ({ appState: st.appState }))

const prov = vi.hoisted(() => ({
  p: null as unknown as { id: string; name: string; baseUrl: string; defaultModel: string; noKey: boolean }
}))
vi.mock('../api/providers', () => ({
  listProviders: async () => [prov.p],
  getProvider: async (id: string) => (id === prov.p.id ? prov.p : undefined),
  getKey: async () => null
}))

import { PipelineRunner } from './PipelineRunner'
import { RunManager } from './RunManager'
import { worktreeManager } from '../worktree/WorktreeManager'
import { setBrokers } from '../tools/toolExec'
import { FileSystemManager } from '../fs/FileSystemManager'
import { FileEditBroker } from '../editor/FileEditBroker'
import { CommandBroker } from '../executor/CommandBroker'
import type { CommandExecutor } from '../executor/CommandExecutor'
import type { PipelineStep, RunInfo } from '../../shared/types'

// --- scriptable mock model server ---
type Responder = (res: ServerResponse) => void
let script: Responder[] = []
let callCount = 0
let server: http.Server

const FR = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`
const toolCallFrame = (name: string, args: unknown): string =>
  FR({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })
const contentFrame = (t: string): string => FR({ choices: [{ delta: { content: t } }] })
function sendSSE(res: ServerResponse, frames: string[]): void {
  if (res.writableEnded) return
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const f of frames) res.write(f)
  res.write('data: [DONE]\n\n')
  res.end()
}
// convenience responders
const emits = (...frames: string[]): Responder => (res) => sendSSE(res, frames)

// Build a fresh runner+manager (don't touch the app's global singletons).
function makeManager(): RunManager {
  const runner = new PipelineRunner(
    {} as never,
    { listDebateAgents: async () => [{ id: 'api:mock', name: 'Mock', kind: 'api' }] } as never
  )
  return new RunManager(runner)
}
async function runToEnd(mgr: RunManager, steps: PipelineStep[], input: string, dryRun = false): Promise<RunInfo> {
  const id = mgr.start(steps, input, dryRun)
  const deadline = Date.now() + 15000
  let rec = mgr.get(id)
  while ((!rec || rec.status === 'queued' || rec.status === 'running') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30))
    rec = mgr.get(id)
  }
  return rec as RunInfo
}

let tmp: string

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'dai-itest-'))
  st.appState.projectRoot = tmp
  const git = (args: string[]): void => void execFileSync('git', args, { cwd: tmp, stdio: 'ignore' })
  git(['init'])
  git(['config', 'user.email', 'test@test'])
  git(['config', 'user.name', 'test'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(tmp, 'seed.txt'), 'seed\n')
  git(['add', '.'])
  git(['commit', '-m', 'init'])

  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      callCount++
      const responder = script.shift() ?? emits(contentFrame('(no script)'))
      responder(res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  prov.p = { id: 'mock', name: 'Mock', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'mock', noKey: true }

  const fsm = new FileSystemManager()
  const editBroker = new FileEditBroker(fsm)
  const broker = new CommandBroker({ run: async () => '', execOnce: async () => '' } as unknown as CommandExecutor)
  setBrokers(broker, editBroker, fsm)
})

afterAll(() => {
  server?.close()
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

beforeEach(() => {
  script = []
  callCount = 0
})

describe('pipeline end-to-end (headless)', () => {
  it('edit step: writes in an isolated worktree, then merges to base', async () => {
    script = [
      emits(toolCallFrame('write_file', { path: 'hello.txt', content: 'hi from pipeline\n' })),
      emits(contentFrame('wrote hello.txt'))
    ]
    const mgr = makeManager()
    const rec = await runToEnd(mgr, [{ agentId: 'api:mock', permission: 'edit', instruction: 'write it' }], 'go')

    expect(rec.status).toBe('done')
    const wt = worktreeManager.infos().find((w) => w.kind === 'pipeline')
    expect(wt).toBeTruthy()
    expect(readFileSync(join(wt!.path, 'hello.txt'), 'utf8')).toContain('hi from pipeline')
    expect(existsSync(join(tmp, 'hello.txt'))).toBe(false)

    await worktreeManager.remove(tmp, wt!.sessionId, 'merge')
    expect(existsSync(join(tmp, 'hello.txt'))).toBe(true)
  })

  it('dry-run: reports the intended edit, writes nothing, creates no worktree', async () => {
    script = [
      emits(toolCallFrame('write_file', { path: 'nope.txt', content: 'should not land' })),
      emits(contentFrame('would write nope.txt'))
    ]
    const before = worktreeManager.infos().length
    const mgr = makeManager()
    const rec = await runToEnd(mgr, [{ agentId: 'api:mock', permission: 'edit', instruction: 'write it' }], 'go', true)

    expect(rec.status).toBe('done')
    const stepText = rec.updates.find((u) => u.type === 'step')?.text ?? ''
    expect(stepText).toMatch(/dry-run/i)
    expect(existsSync(join(tmp, 'nope.txt'))).toBe(false)
    expect(worktreeManager.infos().length).toBe(before) // no new worktree for a dry-run
  })

  it('conditional step is skipped when its dependency output lacks the marker', async () => {
    // step 1 (api) returns plain content (no tool, 1 call); step 2 only runs if
    // step 1 output contains "FAIL" — it doesn't, so step 2 is skipped (0 calls).
    script = [emits(contentFrame('all tests passed'))]
    const mgr = makeManager()
    const steps: PipelineStep[] = [
      { id: 's1', agentId: 'api:mock', permission: 'read-only', instruction: 'run tests' },
      { id: 's2', agentId: 'api:mock', permission: 'edit', deps: ['s1'], condition: { contains: 'FAIL' }, instruction: 'fix' }
    ]
    const rec = await runToEnd(mgr, steps, 'go')

    expect(rec.status).toBe('done')
    expect(callCount).toBe(1) // only step 1 hit the model
    const s2 = rec.updates.filter((u) => u.type === 'step')[1]
    expect(s2?.text).toMatch(/skipped/i)
  })

  it('cancel aborts an in-flight run', async () => {
    // server stalls; we cancel before it responds → AbortError → "Cancelled."
    script = [
      (res) => setTimeout(() => sendSSE(res, [contentFrame('too late')]), 3000)
    ]
    const mgr = makeManager()
    const id = mgr.start([{ agentId: 'api:mock', permission: 'read-only', instruction: 'slow' }], 'go')
    // wait until it's actually running, then cancel
    const start = Date.now()
    while (mgr.get(id)?.status !== 'running' && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 20))
    }
    mgr.cancel(id)
    const deadline = Date.now() + 5000
    while (['running', 'queued'].includes(mgr.get(id)?.status ?? '') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(mgr.get(id)?.status).toBe('cancelled')
  })
})
