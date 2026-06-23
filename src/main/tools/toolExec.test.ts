import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const st = vi.hoisted(() => ({
  appState: { projectRoot: '/root', settings: { allowSecretReads: false }, rootFor: (_id?: string) => '/root' }
}))
vi.mock('../state', () => ({ appState: st.appState }))
const toolBroker = vi.hoisted(() => ({ propose: vi.fn(async () => 'mcp-proposed'), runWithPolicy: vi.fn(async () => 'mcp-auto') }))
vi.mock('../mcp/ToolBroker', () => ({ toolBroker }))
vi.mock('../mcp/MCPClientManager', () => ({ mcpManager: { tools: () => [], call: vi.fn() } }))
vi.mock('../fs/git', () => ({ gitDiff: vi.fn(async () => 'diff') }))
vi.mock('../fs/repoMap', () => ({ buildRepoMap: vi.fn(() => 'map') }))

import { execTool, setBrokers } from './toolExec'

const fsm = {
  readFile: vi.fn(async (_path: string) => 'hello world'),
  listFiles: vi.fn(async () => ['src/a.ts']),
  search: vi.fn(async () => ['.env:1: SECRET=1', 'src/a.ts:2: foo'])
}
const editBroker = { propose: vi.fn(async () => 'edit-proposed'), runWithPolicy: vi.fn(async () => 'edit-auto') }
const broker = { propose: vi.fn(async () => 'cmd-proposed'), runWithPolicy: vi.fn(async () => 'cmd-auto') }
const POLICY = { mode: 'autonomous' as const, allow: ['*'] }

beforeEach(() => {
  vi.clearAllMocks()
  st.appState.settings.allowSecretReads = false
  setBrokers(broker as never, editBroker as never, fsm as never)
})
afterEach(() => vi.clearAllMocks())

describe('execTool gates', () => {
  it('read_file blocks a secret path when allowSecretReads is off', async () => {
    const out = await execTool('read_file', { path: '.env' })
    expect(out).toMatch(/blocked.*secret/i)
    expect(fsm.readFile).not.toHaveBeenCalled()
  })

  it('read_file allows a secret path when the setting is on', async () => {
    st.appState.settings.allowSecretReads = true
    const out = await execTool('read_file', { path: '.env' })
    expect(out).toBe('hello world')
    expect(fsm.readFile).toHaveBeenCalled()
  })

  it('read_file resolves the path against the session root', async () => {
    await execTool('read_file', { path: 'src/a.ts' })
    expect(fsm.readFile.mock.calls[0][0].replace(/\\/g, '/')).toMatch(/\/root\/src\/a\.ts$/)
  })

  it('search_code filters out hits from secret files', async () => {
    const out = await execTool('search_code', { query: 'x' })
    expect(out).not.toMatch(/\.env/)
    expect(out).toMatch(/src\/a\.ts/)
  })

  it('apply_edit reports when the find text is absent', async () => {
    const out = await execTool('apply_edit', { path: 'a.ts', find: 'zzz', replace: 'q' }, 'api', 'api', POLICY)
    expect(out).toMatch(/text not found/i)
    expect(editBroker.runWithPolicy).not.toHaveBeenCalled()
  })

  it('apply_edit routes the patched content through the edit broker (policy path)', async () => {
    const out = await execTool('apply_edit', { path: 'a.ts', find: 'hello', replace: 'bye' }, 'api', 'api', POLICY)
    expect(out).toBe('edit-auto')
    expect(editBroker.runWithPolicy).toHaveBeenCalledWith('a.ts', 'bye world', 'api', 'apply_edit', POLICY, '/root')
  })

  it('write_file / run_command / MCP route through their brokers under policy', async () => {
    await execTool('write_file', { path: 'b.ts', content: 'X' }, 'api', 'api', POLICY)
    expect(editBroker.runWithPolicy).toHaveBeenCalledWith('b.ts', 'X', 'api', 'write_file', POLICY, '/root')
    await execTool('run_command', { command: 'ls' }, 'api', 'sess', POLICY)
    expect(broker.runWithPolicy).toHaveBeenCalledWith('ls', 'api', 'sess', POLICY)
    await execTool('srv__tool', { q: 1 }, 'api', 'api', POLICY)
    expect(toolBroker.runWithPolicy).toHaveBeenCalledWith('srv__tool', { q: 1 }, POLICY)
  })

  it('without a policy, mutating tools use the human-approval (propose) path', async () => {
    await execTool('write_file', { path: 'b.ts', content: 'X' })
    expect(editBroker.propose).toHaveBeenCalled()
    expect(editBroker.runWithPolicy).not.toHaveBeenCalled()
  })
})
