import { describe, it, expect } from 'vitest'
import { parseChatPayload } from './sseParse'

describe('parseChatPayload', () => {
  it('returns null for sentinels and garbage', () => {
    expect(parseChatPayload('')).toBeNull()
    expect(parseChatPayload('[DONE]')).toBeNull()
    expect(parseChatPayload('{not json')).toBeNull()
  })

  it('extracts streamed content', () => {
    const d = parseChatPayload(JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }))
    expect(d?.content).toBe('hi')
    expect(d?.toolCalls).toEqual([])
    expect(d?.usage).toBeUndefined()
  })

  it('extracts the usage frame (empty choices)', () => {
    const d = parseChatPayload(JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 34 } }))
    expect(d?.usage).toEqual({ promptTokens: 12, completionTokens: 34 })
  })

  it('defaults missing usage counts to 0', () => {
    const d = parseChatPayload(JSON.stringify({ usage: { prompt_tokens: 5 } }))
    expect(d?.usage).toEqual({ promptTokens: 5, completionTokens: 0 })
  })

  it('extracts a tool_call delta with index/id/name/args', () => {
    const d = parseChatPayload(
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run', arguments: '{"a' } }] } }]
      })
    )
    expect(d?.toolCalls).toEqual([{ index: 0, id: 'c1', name: 'run', argsChunk: '{"a' }])
  })

  it('handles a partial tool_call args chunk (no id/name)', () => {
    const d = parseChatPayload(
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'b"}' } }] } }] })
    )
    expect(d?.toolCalls[0]).toEqual({ index: 0, id: undefined, name: undefined, argsChunk: 'b"}' })
  })

  it('returns an empty (no-op) delta for a content-less keepalive frame', () => {
    const d = parseChatPayload(JSON.stringify({ choices: [{ delta: {} }] }))
    expect(d).toEqual({ toolCalls: [] })
  })
})
