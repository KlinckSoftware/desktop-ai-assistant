import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import http from 'http'
import type { AddressInfo } from 'net'

// End-to-end, headless: drive a real pipeline run through RunManager →
// PipelineRunner → OpenAIClient (real SSE tool loop) → execTool → FileEditBroker
// → a real git worktree, with ONLY the model faked by a local SSE server. No GUI,
// no clicking. Proves the isolation→tool→review path works for real.

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

const prov = vi.hoisted(() => ({ p: null as unknown as { id: string; name: string; baseUrl: string; defaultModel: string; noKey: boolean } }))
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

let tmp: string
let server: http.Server
let calls = 0

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'dai-itest-'))
  st.appState.projectRoot = tmp
  // a real git repo with one commit (worktree -b needs a base)
  const git = (args: string[]): void => void execFileSync('git', args, { cwd: tmp, stdio: 'ignore' })
  git(['init'])
  git(['config', 'user.email', 'test@test'])
  git(['config', 'user.name', 'test'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(tmp, 'seed.txt'), 'seed\n')
  git(['add', '.'])
  git(['commit', '-m', 'init'])

  // local model: 1st call → write_file tool call; 2nd → final text.
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      calls++
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`
      if (calls === 1) {
        res.write(
          frame({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'write_file', arguments: JSON.stringify({ path: 'hello.txt', content: 'hi from pipeline\n' }) }
                    }
                  ]
                }
              }
            ]
          })
        )
      } else {
        res.write(frame({ choices: [{ delta: { content: 'wrote hello.txt' } }] }))
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  prov.p = { id: 'mock', name: 'Mock', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'mock', noKey: true }

  // wire the real tool brokers (CommandExecutor is a type-only dep of the broker;
  // a stub stands in since this test only writes a file, no shell).
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

describe('pipeline end-to-end (headless)', () => {
  it('runs an edit step in an isolated worktree, writes the file, then merges to base', async () => {
    const runner = new PipelineRunner(
      {} as never,
      { listDebateAgents: async () => [{ id: 'api:mock', name: 'Mock', kind: 'api' }] } as never
    )
    const mgr = new RunManager(runner)

    const id = mgr.start([{ agentId: 'api:mock', permission: 'edit', instruction: 'write hello.txt' }], 'go', false)

    // wait for completion (no GUI)
    const deadline = Date.now() + 15000
    let rec = mgr.get(id)
    while ((!rec || rec.status === 'queued' || rec.status === 'running') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
      rec = mgr.get(id)
    }
    expect(rec?.status).toBe('done')
    expect(calls).toBeGreaterThanOrEqual(2) // tool turn + final turn

    // a pipeline worktree was created and the file landed INSIDE it (not the base)
    const wt = worktreeManager.infos().find((w) => w.kind === 'pipeline')
    expect(wt).toBeTruthy()
    expect(existsSync(join(wt!.path, 'hello.txt'))).toBe(true)
    expect(readFileSync(join(wt!.path, 'hello.txt'), 'utf8')).toContain('hi from pipeline')
    expect(existsSync(join(tmp, 'hello.txt'))).toBe(false) // not in base yet

    // merge the branch → file appears in the base repo
    await worktreeManager.remove(tmp, wt!.sessionId, 'merge')
    expect(existsSync(join(tmp, 'hello.txt'))).toBe(true)
  })
})
