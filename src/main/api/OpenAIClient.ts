import { appState } from '../state'
import { CH, type Message } from '../../shared/types'
import { getProvider, getKey } from './providers'
import { toolSpecs, execTool } from '../tools/toolExec'
import { parseChatPayload } from './sseParse'
import type { ApprovalPolicy } from '../policy/ApprovalPolicy'

const DONE = '[[api:done]]'

// Max number of model<->tool round-trips before we stop feeding results back.
const MAX_TOOL_TURNS = 8

// Retry transient transport failures with a short exponential backoff. We retry
// only on conditions that are plausibly recoverable: a thrown network error, or
// an HTTP 429 / 5xx. Other 4xx (auth, bad request) are caller errors and fail
// fast. `attemptFetch` returns the Response; `isRetryableStatus` lets the caller
// decide per-status (a non-ok response is not thrown, so we inspect it here).
const RETRY_BACKOFF_MS = [300, 600] // one entry per retry → 2 retries total

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Run `attempt` (a fetch wrapper) with bounded retries. Retries when `attempt`
// throws (network error) or returns a response whose status is retryable. After
// the final attempt the last result/error is surfaced unchanged so callers keep
// their existing error handling.
async function fetchWithRetry(attempt: () => Promise<Response>): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i <= RETRY_BACKOFF_MS.length; i++) {
    try {
      const res = await attempt()
      if (isRetryableStatus(res.status) && i < RETRY_BACKOFF_MS.length) {
        await sleep(RETRY_BACKOFF_MS[i])
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      // An aborted request (caller cancelled) must never be retried — surface it.
      if (err instanceof Error && err.name === 'AbortError') throw err
      if (i < RETRY_BACKOFF_MS.length) {
        await sleep(RETRY_BACKOFF_MS[i])
        continue
      }
      throw lastErr
    }
  }
  // Unreachable (the loop always returns or throws on the last iteration), but
  // keeps the type checker happy.
  throw lastErr
}

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

  try {
    const { promptTokens, completionTokens } = await runToolLoop({
      url,
      key,
      model,
      messages,
      tools,
      emit,
      sessionId: 'api', // interactive chat: human approval cards (no policy)
      // Stream "[calling …]" markers as the model invokes tools.
      onCalls: (calls) => emit(`\n\n_[calling ${calls.map((c) => c.name).join(', ')}]_\n\n`)
    })
    if (promptTokens || completionTokens) {
      appState.send(CH.usage, instanceId, { promptTokens, completionTokens })
    }
    emit(DONE)
  } catch (err) {
    emit(`\n[API request failed: ${err instanceof Error ? err.message : String(err)}]` + DONE)
  }
}

// Agentic completion for a pipeline step: same tool loop as apiSend, but gated
// by an ApprovalPolicy (autonomous/dry-run, no human card) and returning a text
// transcript instead of streaming to a chat panel. Tool activity is inlined so
// the pipeline step output shows what the model did. Throws on transport error.
export async function apiCompleteAgentic(
  providerId: string,
  model: string,
  history: Message[],
  policy: ApprovalPolicy
): Promise<string> {
  const provider = await getProvider(providerId)
  if (!provider) throw new Error(`unknown provider ${providerId}`)
  const key = (provider.noKey ? '' : await getKey(providerId)) ?? ''
  if (!provider.noKey && !key) throw new Error(`no key set for ${provider.name}`)

  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`
  const tools = toolSpecs().map((s) => ({ type: 'function', function: s }))
  const messages: OAMessage[] = history
    .filter((m) => m.content)
    .map((m) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content }))

  // No streaming to a panel — accumulate a text transcript instead. The loop
  // appends model text via onText and inline tool markers via onToolResult.
  let transcript = ''
  const noEmit = (): void => {}
  await runToolLoop({
    url,
    key,
    model: model || provider.defaultModel,
    messages,
    tools,
    emit: noEmit,
    sessionId: `pipeline:${providerId}`,
    policy, // autonomous/dry-run: route tools through the policy, not a card
    onText: (text) => {
      transcript += text
    },
    onToolResult: (name, result) => {
      transcript += `\n\n_[${name} → ${result.slice(0, 200)}]_\n`
    }
  })
  return transcript.trim()
}

// One-shot, non-streaming completion with no tools — used by the debate
// moderator so an API provider can be a debate participant. Throws on error so
// the moderator surfaces it.
export async function apiComplete(
  providerId: string,
  model: string,
  history: Message[],
  signal?: AbortSignal
): Promise<string> {
  const provider = await getProvider(providerId)
  if (!provider) throw new Error(`unknown provider ${providerId}`)
  const key = (provider.noKey ? '' : await getKey(providerId)) ?? ''
  if (!provider.noKey && !key) throw new Error(`no key set for ${provider.name}`)

  const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`
  const messages = history
    .filter((m) => m.content)
    .map((m) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content }))

  const res = await fetchWithRetry(() =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: model || provider.defaultModel, messages, stream: false }),
      signal
    })
  )
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`${provider.name} ${res.status}: ${errText.slice(0, 300)}`)
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return json?.choices?.[0]?.message?.content ?? ''
}

// Options for the shared agentic tool loop. `emit` streams text/markers to a
// chat panel (apiSend) or is a no-op (apiCompleteAgentic). The optional callbacks
// let a caller observe model text, the calls about to run, and each tool result
// without diverging the loop body. `policy` (when set) is forwarded to execTool
// so mutating tools run autonomously instead of prompting a human card.
interface ToolLoopOpts {
  url: string
  key: string
  model: string
  messages: OAMessage[]
  tools: unknown[]
  emit: (c: string) => void
  sessionId: string
  policy?: ApprovalPolicy
  onText?: (text: string) => void
  onCalls?: (calls: OAToolCall[]) => void
  onToolResult?: (name: string, result: string) => void
}

// Shared model<->tool round-trip loop used by both apiSend (streaming) and
// apiCompleteAgentic (transcript). Runs up to MAX_TOOL_TURNS turns: each turn
// streams one completion, and if the model requested tools it executes them and
// feeds the results back. Returns the summed provider-reported usage.
async function runToolLoop(opts: ToolLoopOpts): Promise<{ promptTokens: number; completionTokens: number }> {
  const { url, key, model, messages, tools, emit, sessionId, policy } = opts
  let promptTokens = 0
  let completionTokens = 0

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const { text, calls, usage } = await streamOnce(url, key, model, messages, tools, emit)
    if (text) opts.onText?.(text)
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
    opts.onCalls?.(calls)
    for (const c of calls) {
      let args: Record<string, unknown> = {}
      try {
        args = c.args ? JSON.parse(c.args) : {}
      } catch {
        /* leave empty on malformed args */
      }
      const result = await execTool(c.name, args, 'api', sessionId, policy)
      opts.onToolResult?.(c.name, result)
      messages.push({ role: 'tool', tool_call_id: c.id, content: result })
    }
  }
  return { promptTokens, completionTokens }
}

async function streamOnce(
  url: string,
  key: string,
  model: string,
  messages: OAMessage[],
  tools: unknown[],
  emit: (c: string) => void,
  signal?: AbortSignal
): Promise<{ text: string; calls: OAToolCall[]; usage: { promptTokens: number; completionTokens: number } | null }> {
  let res: Response
  try {
    res = await fetchWithRetry(() =>
      fetch(url, {
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
        }),
        signal
      })
    )
  } catch (err) {
    // Network error survived all retries — surface it like a non-ok response.
    emit(`\n[API error: ${err instanceof Error ? err.message : String(err)}]`)
    return { text: '', calls: [], usage: null }
  }
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
      const d = parseChatPayload(line.slice(5))
      if (!d) continue
      if (d.usage) usage = d.usage
      if (d.content) {
        text += d.content
        emit(d.content)
      }
      for (const tc of d.toolCalls) {
        const cur = byIndex.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) cur.id = tc.id
        if (tc.name) cur.name = tc.name
        if (tc.argsChunk) cur.args += tc.argsChunk
        byIndex.set(tc.index, cur)
      }
    }
  }
  return { text, calls: [...byIndex.values()].filter((c) => c.name), usage }
}
