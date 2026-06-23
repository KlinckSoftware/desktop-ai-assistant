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
