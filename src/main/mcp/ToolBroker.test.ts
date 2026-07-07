import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state', () => ({ appState: { send: vi.fn() } }))
const call = vi.hoisted(() => vi.fn(async () => 'ok'))
vi.mock('./MCPClientManager', () => ({ mcpManager: { call } }))

import { ToolBroker } from './ToolBroker'

const AUTO = { mode: 'autonomous' as const, allow: ['*'] }

describe('ToolBroker.runWithPolicy — autonomous MCP arg screening', () => {
  let broker: ToolBroker
  beforeEach(() => {
    call.mockClear()
    broker = new ToolBroker()
  })

  it('runs an allowlisted tool with safe args', async () => {
    const out = await broker.runWithPolicy('srv__search', { query: 'hello world' }, AUTO)
    expect(out).toBe('ok')
    expect(call).toHaveBeenCalledOnce()
  })

  it('blocks when serialized args match the dangerous denylist (never reaches the server)', async () => {
    const out = await broker.runWithPolicy('srv__run', { command: 'rm -rf /' }, AUTO)
    expect(out).toMatch(/blocked: dangerous MCP argument/i)
    expect(call).not.toHaveBeenCalled()
  })

  it('blocks a non-allowlisted tool before screening', async () => {
    const out = await broker.runWithPolicy('srv__x', {}, { mode: 'autonomous', allow: ['read_file'] })
    expect(out).toMatch(/blocked by policy/i)
    expect(call).not.toHaveBeenCalled()
  })
})

describe('ToolBroker — interactive dangerous-arg screening', () => {
  let broker: ToolBroker
  beforeEach(() => {
    call.mockClear()
    broker = new ToolBroker()
  })

  it('flags dangerous args on the pending card', async () => {
    const { appState } = await import('../state')
    void broker.propose('srv__run', { command: 'rm -rf /' })
    const sent = (appState.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]
    expect(sent.dangerous).toBe(true)
    expect(sent.dangerReason).toBeTruthy()
  })

  it('plain approve() refuses a dangerous call (main-authoritative)', async () => {
    const p = broker.propose('srv__run', { command: 'rm -rf /' })
    await broker.approve('tool_1')
    expect(await p).toMatch(/needs explicit confirmation/i)
    expect(call).not.toHaveBeenCalled()
  })

  it('confirmDangerous() executes it', async () => {
    const p = broker.propose('srv__run', { command: 'rm -rf /' })
    await broker.confirmDangerous('tool_1')
    expect(await p).toBe('ok')
    expect(call).toHaveBeenCalledOnce()
  })

  it('safe args stay un-flagged and approve normally', async () => {
    const p = broker.propose('srv__search', { query: 'hello' })
    await broker.approve('tool_1')
    expect(await p).toBe('ok')
  })
})
