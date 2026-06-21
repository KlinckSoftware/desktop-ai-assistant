import { appState } from '../state'
import { CH, type Message } from '../../shared/types'
import { getProvider, getKey } from './providers'
import { toolSpecs, execTool } from '../tools/toolExec'

const DONE = '[[api:done]]'

interface OAToolCall {
  id: string
  name: string
  args: string // accumulated JSON string
}
// OpenAI chat message shape (supports tool calls + tool results).
interface OAMessage {
  role: string
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

// Agentic streaming chat over an OpenAI-compatible /chat/completions endpoint.
// Exposes run_command/write_file + MCP tools; tool calls route through approval
// and results are fed back until the model returns a final answer. Streamed text
// is tagged with instanceId so the right API-chat panel receives it.
export async function apiSend(
  instanceId: string,
  providerId: string,
  model: string,
  history: Message[]
): Promise<void> {
  const emit = (chunk: string): void => appState.send(CH.apiStream, instanceId, chunk)
  const provider = await getProvider(providerId)
  if (!provider) return emit(`\n[API: unknown provider ${providerId}]` + DONE)
  const key = (provider.noKey ? '' : await getKey(providerId)) ?? ''
  if (!provider.noKey && !key) return emit(`\n[API: no key set for ${provider.name}]` + DONE)

  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`
  const tools = toolSpecs().map((s) => ({ type: 'function', function: s }))
  const messages: OAMessage[] = history
    .filter((m) => m.content)
    .map((m) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content }))

  let promptTokens = 0
  let completionTokens = 0

  try {
    for (let turn = 0; turn < 8; turn++) {
      const { text, calls, usage } = await streamOnce(url, key, model, messages, tools, emit)
      if (usage) {
        promptTokens += usage.promptTokens
        completionTokens += usage.completionTokens
      }
      if (calls.length === 0) break

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } }))
      })
      emit(`\n\n_[calling ${calls.map((c) => c.name).join(', ')}]_\n\n`)
      for (const c of calls) {
        let args: Record<string, unknown> = {}
        try {
          args = c.args ? JSON.parse(c.args) : {}
        } catch {
          /* leave empty on malformed args */
        }
        const result = await execTool(c.name, args)
        messages.push({ role: 'tool', tool_call_id: c.id, content: result })
      }
    }
    if (promptTokens || completionTokens) {
      appState.send(CH.usage, instanceId, { promptTokens, completionTokens })
    }
    emit(DONE)
  } catch (err) {
    emit(`\n[API request failed: ${err instanceof Error ? err.message : String(err)}]` + DONE)
  }
}

// One-shot, non-streaming completion with no tools — used by the debate
// moderator so an API provider can be a debate participant. Throws on error so
// the moderator surfaces it.
export async function apiComplete(providerId: string, model: string, history: Message[]): Promise<string> {
  const provider = await getProvider(providerId)
  if (!provider) throw new Error(`unknown provider ${providerId}`)
  const key = (provider.noKey ? '' : await getKey(providerId)) ?? ''
  if (!provider.noKey && !key) throw new Error(`no key set for ${provider.name}`)

  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`
  const messages = history
    .filter((m) => m.content)
    .map((m) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content }))

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: model || provider.defaultModel, messages, stream: false })
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`${provider.name} ${res.status}: ${errText.slice(0, 300)}`)
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return json?.choices?.[0]?.message?.content ?? ''
}

async function streamOnce(
  url: string,
  key: string,
  model: string,
  messages: OAMessage[],
  tools: unknown[],
  emit: (c: string) => void
): Promise<{ text: string; calls: OAToolCall[]; usage: { promptTokens: number; completionTokens: number } | null }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    // include_usage asks the provider to append a final chunk with token counts
    // (OpenAI/Mistral/OpenRouter honor it; Groq/Ollama may omit — handled as null).
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      tools,
      tool_choice: 'auto'
    })
  })
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText)
    emit(`\n[API error ${res.status}: ${errText.slice(0, 500)}]`)
    return { text: '', calls: [], usage: null }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let usage: { promptTokens: number; completionTokens: number } | null = null
  const byIndex = new Map<number, OAToolCall>() // tool_calls stream in deltas by index

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const obj = JSON.parse(payload)
        if (obj?.usage) {
          usage = {
            promptTokens: obj.usage.prompt_tokens ?? 0,
            completionTokens: obj.usage.completion_tokens ?? 0
          }
        }
        const delta = obj?.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) {
          text += delta.content
          emit(delta.content)
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0
          const cur = byIndex.get(idx) ?? { id: '', name: '', args: '' }
          if (tc.id) cur.id = tc.id
          if (tc.function?.name) cur.name = tc.function.name
          if (tc.function?.arguments) cur.args += tc.function.arguments
          byIndex.set(idx, cur)
        }
      } catch {
        /* partial frame */
      }
    }
  }
  return { text, calls: [...byIndex.values()].filter((c) => c.name), usage }
}
