import { appState } from '../state'
import { CH, type Message } from '../../shared/types'
import { KeychainManager } from '../keychain/KeychainManager'
import { mcpManager } from '../mcp/MCPClientManager'
import { toolBroker } from '../mcp/ToolBroker'
import type { CommandBroker } from '../executor/CommandBroker'
import type { FileEditBroker } from '../editor/FileEditBroker'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const SYSTEM = `You are an expert coding assistant working inside a desktop IDE.
You have function tools available:
- run_command: run a shell command on the user's machine (they approve first).
- write_file: create or overwrite a file with full new contents (they approve first).
- plus any configured MCP tools.
Prefer these tools over describing actions in prose. Inspect/build/verify with
run_command; make changes with write_file. Tool results are returned to you.`

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
}
interface GeminiContent {
  role: string
  parts: GeminiPart[]
}
interface FunctionDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}
interface ToolCall {
  name: string
  args: Record<string, unknown>
}

export interface ImagePart {
  mime: string
  base64: string
}

// Gemini's function schema is a strict OpenAPI subset — strip JSON-schema keys
// it rejects ($schema, additionalProperties, $ref, etc.), keep the basics.
const ALLOWED = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'nullable'
])
function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!ALLOWED.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {}
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = sanitizeSchema(pv)
      out.properties = props
    } else if (k === 'items') {
      out.items = sanitizeSchema(v)
    } else {
      out[k] = v
    }
  }
  if (!out.type) out.type = 'object'
  return out
}

export class GeminiClient {
  constructor(
    private broker: CommandBroker,
    private editBroker: FileEditBroker
  ) {}

  async hasKey(): Promise<boolean> {
    return KeychainManager.hasKey()
  }
  async saveKey(key: string): Promise<void> {
    await KeychainManager.setKey(key.trim())
  }

  // Built-in + MCP tools as Gemini function declarations.
  private buildTools(): { functionDeclarations: FunctionDeclaration[] } {
    const decls: FunctionDeclaration[] = [
      {
        name: 'run_command',
        description: 'Run a shell command on the user machine (requires approval). Returns its output.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'The shell command to run.' } },
          required: ['command']
        }
      },
      {
        name: 'write_file',
        description: 'Create or overwrite a file with full new contents (requires approval).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to the project root.' },
            content: { type: 'string', description: 'The entire new file contents.' }
          },
          required: ['path', 'content']
        }
      }
    ]
    for (const t of mcpManager.tools()) {
      decls.push({
        name: t.qualified,
        description: t.description || `MCP tool ${t.name} on ${t.server}`,
        parameters: sanitizeSchema(t.inputSchema)
      })
    }
    return { functionDeclarations: decls }
  }

  private async execCall(call: ToolCall): Promise<string> {
    if (call.name === 'run_command') {
      return this.broker.propose(String(call.args.command ?? ''), 'gemini', 'gemini-main')
    }
    if (call.name === 'write_file') {
      return this.editBroker.propose(String(call.args.path ?? ''), String(call.args.content ?? ''), 'gemini')
    }
    return toolBroker.propose(call.name, call.args) // MCP tool
  }

  async send(prompt: string, history: Message[], images: ImagePart[] = [], maxTurns = 8): Promise<string> {
    const apiKey = await KeychainManager.getKey()
    if (!apiKey) {
      appState.send(CH.geminiStream, '\n[Gemini: no API key set. Add one in settings.]')
      return ''
    }

    const contents: GeminiContent[] = history
      .filter((m) => m.content)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }))
    contents.push({
      role: 'user',
      parts: [{ text: prompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mime, data: im.base64 } }))]
    })

    const tools = this.buildTools()
    let full = ''
    for (let turn = 0; turn < maxTurns; turn++) {
      const { text, calls } = await this.streamOnce(apiKey, contents, { tools })
      full += text
      if (calls.length === 0) break

      // Echo the model's turn (text + the calls it made) into history.
      const modelParts: GeminiPart[] = []
      if (text) modelParts.push({ text })
      for (const c of calls) modelParts.push({ functionCall: { name: c.name, args: c.args } })
      contents.push({ role: 'model', parts: modelParts })

      appState.send(CH.geminiStream, `\n\n_[calling ${calls.map((c) => c.name).join(', ')}]_\n\n`)

      // Execute (each gated by its approval flow) and return all responses.
      const responses: GeminiPart[] = []
      for (const c of calls) {
        const result = await this.execCall(c)
        responses.push({ functionResponse: { name: c.name, response: { result } } })
      }
      contents.push({ role: 'user', parts: responses })
    }

    appState.send(CH.geminiStream, '\n[[gemini:done]]')
    return full
  }

  /** One-shot text completion — no tools, no chat streaming. For the debate moderator. */
  async complete(prompt: string, history: Message[]): Promise<string> {
    const apiKey = await KeychainManager.getKey()
    if (!apiKey) return '[Gemini: no API key set]'
    const contents: GeminiContent[] = history
      .filter((m) => m.content)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }))
    contents.push({ role: 'user', parts: [{ text: prompt }] })
    return (await this.streamOnce(apiKey, contents, { emit: false })).text
  }

  /** Isolated single-turn call for the SideChat overlay — no tools, no main stream. */
  async sideSend(prompt: string): Promise<string> {
    const apiKey = await KeychainManager.getKey()
    if (!apiKey) return '[Gemini: no API key set]'
    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }]
    return (await this.streamOnce(apiKey, contents, { emit: false })).text
  }

  /**
   * One streaming generateContent call. Returns accumulated text + any function
   * calls the model emitted. `emit` streams text chunks to the chat channel.
   */
  private async streamOnce(
    apiKey: string,
    contents: GeminiContent[],
    opts: { emit?: boolean; tools?: { functionDeclarations: FunctionDeclaration[] } } = {}
  ): Promise<{ text: string; calls: ToolCall[] }> {
    const { emit = true, tools } = opts
    const model = appState.settings.geminiModel
    const url = `${BASE}/${model}:streamGenerateContent?alt=sse`
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM }] }
    }
    if (tools) body.tools = [tools]

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    })

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText)
      const msg = `\n[Gemini error ${res.status}: ${errText.slice(0, 500)}]`
      if (emit) appState.send(CH.geminiStream, msg)
      return { text: msg, calls: [] }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let sseBuf = ''
    let text = ''
    const calls: ToolCall[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sseBuf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = sseBuf.indexOf('\n')) >= 0) {
        const line = sseBuf.slice(0, nl).trim()
        sseBuf = sseBuf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const parts = json?.candidates?.[0]?.content?.parts ?? []
          for (const part of parts) {
            if (part.text) {
              text += part.text
              if (emit) appState.send(CH.geminiStream, part.text)
            } else if (part.functionCall) {
              calls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} })
            }
          }
        } catch {
          /* partial JSON — alt=sse should prevent this */
        }
      }
    }
    return { text, calls }
  }
}
