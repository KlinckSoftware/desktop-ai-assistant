import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execFileSync, exec } from 'child_process'
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
import { IPCModerator } from '../moderator/IPCModerator'
import { CH, type PipelineStep, type RunInfo, type DebateUpdate } from '../../shared/types'

// --- scriptable mock model server ---
type Responder = (res: ServerResponse) => void
let script: Responder[] = []
let callCount = 0
let server: http.Server
// Raw request bodies, one per call, in arrival order — lets tests assert on the
// exact prompt/messages the model received (e.g. interpolated ${id} carries).
let requestBodies: string[] = []

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
// Non-streaming JSON responder — debate participants (apiComplete) POST
// `stream: false` and expect a plain OpenAI-shaped JSON body, not SSE frames.
const jsonReply = (text: string): Responder => (res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content: text } }] }))
}

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
      requestBodies.push(body)
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
  requestBodies = []
})

// Pull the user-role prompt text the mock server actually received for the Nth
// call (0-indexed) — i.e. what the model was asked, after ${id} interpolation.
function promptForCall(n: number): string {
  const parsed = JSON.parse(requestBodies[n]) as { messages: { role: string; content: string }[] }
  return parsed.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
}

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

  it('multi-step carry: step 3 interpolates ${s1} AND ${s2} into its prompt', async () => {
    script = [
      emits(contentFrame('OUTPUT_ONE')),
      emits(contentFrame('OUTPUT_TWO')),
      emits(contentFrame('combined done'))
    ]
    const mgr = makeManager()
    const steps: PipelineStep[] = [
      { id: 's1', agentId: 'api:mock', permission: 'read-only', instruction: 'first step' },
      { id: 's2', agentId: 'api:mock', permission: 'read-only', deps: [], instruction: 'second step' },
      {
        id: 's3',
        agentId: 'api:mock',
        permission: 'read-only',
        deps: ['s1', 's2'],
        instruction: 'merge: s1=${s1} s2=${s2}'
      }
    ]
    const rec = await runToEnd(mgr, steps, 'go')

    expect(rec.status).toBe('done')
    expect(callCount).toBe(3)
    // The 3rd model call (index 2) is the one whose prompt was interpolated —
    // assert the ACTUAL resolved prompt the mock server received contains both
    // prior steps' outputs verbatim.
    const p3 = promptForCall(2)
    expect(p3).toContain('OUTPUT_ONE')
    expect(p3).toContain('OUTPUT_TWO')
    expect(p3).toContain('s1=OUTPUT_ONE')
    expect(p3).toContain('s2=OUTPUT_TWO')
  })

  it('map fan-out: N input lines run N sub-invocations with the combined output shape', async () => {
    // Step 1 (api, read-only) produces 3 lines of "input" for the map step.
    // Step 2 is a map step with no deps override (defaults to depending on s1),
    // so mapItems(combinedInput(...)) splits s1's output into 3 non-empty lines.
    script = [
      emits(contentFrame('line-a\nline-b\nline-c')),
      emits(contentFrame('result-a')),
      emits(contentFrame('result-b')),
      emits(contentFrame('result-c'))
    ]
    const mgr = makeManager()
    const steps: PipelineStep[] = [
      { id: 's1', agentId: 'api:mock', permission: 'read-only', instruction: 'list items' },
      { id: 's2', agentId: 'api:mock', permission: 'read-only', deps: ['s1'], instruction: 'process', map: true }
    ]
    const rec = await runToEnd(mgr, steps, 'go')

    expect(rec.status).toBe('done')
    // 1 call for s1 + 3 sub-invocations (one per mapped line) for s2.
    expect(callCount).toBe(4)
    // Each map sub-invocation's prompt is `${instruction}\n\n${item}` (graph.ts) —
    // verify the 3 fan-out calls actually received one distinct item each.
    expect(promptForCall(1)).toContain('line-a')
    expect(promptForCall(2)).toContain('line-b')
    expect(promptForCall(3)).toContain('line-c')

    // combinedInput/mapItems shape: the step's final text joins each item's
    // "— [k/N] <item-prefix>\n<output>" block (see PipelineRunner.run's map branch).
    const s2 = rec.updates.filter((u) => u.type === 'step')[1]
    expect(s2?.text).toContain('[1/3] line-a')
    expect(s2?.text).toContain('result-a')
    expect(s2?.text).toContain('[2/3] line-b')
    expect(s2?.text).toContain('result-b')
    expect(s2?.text).toContain('[3/3] line-c')
    expect(s2?.text).toContain('result-c')
  })

  it('full step + allowFull: run_command reaches real execOnce and its result lands in the transcript', async () => {
    // Swap in a CommandBroker whose execOnce shells out for real via
    // child_process.exec (the exact same call CommandExecutor.execOnce makes —
    // see src/main/executor/CommandExecutor.ts) so run_command exercises the
    // real non-pty exec path, cross-platform and harmless: `git --version`.
    // We deliberately do NOT construct a real CommandExecutor here — its
    // constructor spawns an interactive pty shell, which this headless test
    // doesn't need (run_command never touches the pty; only execOnce does).
    const fsm = new FileSystemManager()
    const editBroker = new FileEditBroker(fsm)
    const realExecOnce = (command: string, cwd: string): Promise<string> =>
      new Promise((resolve) => {
        exec(command, { cwd, windowsHide: true }, (err, stdout, stderr) => {
          const out = `${stdout || ''}${stderr || ''}`.trimEnd()
          resolve(err && !out ? `[command failed: ${err.message}]` : out || '[no output]')
        })
      })
    const realBroker = new CommandBroker({ run: async () => '', execOnce: realExecOnce } as unknown as CommandExecutor)
    setBrokers(realBroker, editBroker, fsm)
    try {
      script = [
        emits(toolCallFrame('run_command', { command: 'git --version' })),
        emits(contentFrame('ran it'))
      ]
      const mgr = makeManager()
      const steps: PipelineStep[] = [
        { id: 's1', agentId: 'api:mock', permission: 'full', instruction: 'check git' }
      ]
      const id = mgr.start(steps, 'go', false, true) // allowFull=true
      const deadline = Date.now() + 15000
      let rec = mgr.get(id)
      while ((!rec || rec.status === 'queued' || rec.status === 'running') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 30))
        rec = mgr.get(id)
      }

      expect(rec?.status).toBe('done')
      expect(callCount).toBe(2) // 1 tool-call turn + 1 follow-up turn after the tool result
      const s1 = rec!.updates.find((u) => u.type === 'step')
      // apiCompleteAgentic inlines each tool result as `_[name → result]_` (OpenAIClient.ts)
      expect(s1?.text).toMatch(/_\[run_command → /)
      expect(s1?.text).toMatch(/git version/i)
      expect(s1?.text).toContain('ran it')
    } finally {
      // Restore the shared no-op brokers other tests in this file rely on.
      const noopBroker = new CommandBroker({ run: async () => '', execOnce: async () => '' } as unknown as CommandExecutor)
      setBrokers(noopBroker, editBroker, fsm)
    }
  })

  it('debate: one round + synthesis end-to-end against the mock server (no production changes needed)', async () => {
    // IPCModerator.listDebateAgents() sources API participants from the SAME
    // mocked listProviders() this file already uses for the pipeline, so pointing
    // a debate at the mock SSE server needs no src changes — both debate seats
    // are the mock provider, isolating this test from claude/gemini availability.
    const mod = new IPCModerator(
      { hasKey: async () => false } as never,
      new CommandBroker({ run: async () => '', execOnce: async () => '' } as unknown as CommandExecutor)
    )
    st.appState.events = []

    script = [
      jsonReply('A: proposal text'), // round 1, side a
      jsonReply('B: critique text') // round 1, side b
    ]
    await mod.runDebate('build a widget', ['api:mock', 'api:mock'], undefined, 1)

    const debateUpdates = st.appState.events
      .filter((e) => e[0] === CH.debateUpdate)
      .map((e) => e[1] as DebateUpdate)
    const turns = debateUpdates.filter((u) => u.type === 'turn')
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ seat: 0, round: 0, text: 'A: proposal text' })
    expect(turns[1]).toMatchObject({ seat: 1, round: 0, text: 'B: critique text' })
    expect(debateUpdates.at(-1)?.type).toBe('await') // paused for synthesis approval
    expect(callCount).toBe(2)

    // Approve → synthesis makes one more model call and emits the final text.
    script = [jsonReply('SYNTHESIZED_RESULT')]
    await mod.synthesize()
    const synth = st.appState.events
      .filter((e) => e[0] === CH.debateUpdate)
      .map((e) => e[1] as DebateUpdate)
      .find((u) => u.type === 'synthesis')
    expect(synth?.text).toBe('SYNTHESIZED_RESULT')
    expect(callCount).toBe(3)
  })
})
