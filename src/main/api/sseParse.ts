// Pure parsing of one OpenAI-compatible /chat/completions SSE payload (the JSON
// after "data: "). Extracted from the streaming loop so it can be unit-tested
// without a live HTTP stream. The caller handles transport + accumulation.

export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  argsChunk?: string // partial JSON arguments to be concatenated by index
}
export interface ChatDelta {
  content?: string
  usage?: { promptTokens: number; completionTokens: number }
  toolCalls: ToolCallDelta[]
}

const EMPTY: ChatDelta = { toolCalls: [] }

// Returns null for sentinels ('', '[DONE]') and unparseable/partial frames.
export function parseChatPayload(payload: string): ChatDelta | null {
  const p = payload.trim()
  if (!p || p === '[DONE]') return null
  let obj: unknown
  try {
    obj = JSON.parse(p)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as {
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    choices?: { delta?: { content?: string; tool_calls?: unknown[] } }[]
  }

  const out: ChatDelta = { toolCalls: [] }
  if (o.usage) {
    out.usage = { promptTokens: o.usage.prompt_tokens ?? 0, completionTokens: o.usage.completion_tokens ?? 0 }
  }
  const delta = o.choices?.[0]?.delta
  if (delta?.content) out.content = delta.content
  for (const raw of delta?.tool_calls ?? []) {
    const tc = raw as { index?: number; id?: string; function?: { name?: string; arguments?: string } }
    out.toolCalls.push({
      index: tc.index ?? 0,
      id: tc.id,
      name: tc.function?.name,
      argsChunk: tc.function?.arguments
    })
  }
  // Nothing useful in this frame → signal "skip" to keep callers simple.
  if (!out.content && !out.usage && out.toolCalls.length === 0) return EMPTY
  return out
}
