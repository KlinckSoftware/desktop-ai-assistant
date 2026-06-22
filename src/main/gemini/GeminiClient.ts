import { appState } from '../state'
import { CH, type Message } from '../../shared/types'
import { KeychainManager } from '../keychain/KeychainManager'
import { toolSpecs, execTool } from '../tools/toolExec'
import { addUsageCost, capReached } from '../budget'
import { AGENT_SYSTEM, MAX_TOOL_TURNS } from '../agents/systemPrompt'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const SYSTEM = AGENT_SYSTEM

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

export class GeminiClient {
  async hasKey(): Promise<boolean> {
    return KeychainManager.hasKey()
  }
  async saveKey(key: string): Promise<void> {
    await KeychainManager.setKey(key.trim())
  }

  // Built-in (read-only + gated) + MCP tools as Gemini function declarations —
  // shared with the API chats via toolSpecs() so both agents expose the same set.
  private buildTools(): { functionDeclarations: FunctionDeclaration[] } {
    return { functionDeclarations: toolSpecs() }
  }

  private async execCall(call: ToolCall): Promise<string> {
    return execTool(call.name, call.args, 'gemini', 'gemini-main')
  }

  async send(prompt: string, history: Message[], images: ImagePart[] = [], maxTurns = MAX_TOOL_TURNS): Promise<string> {
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
    let promptTokens = 0
    let completionTokens = 0
    for (let turn = 0; turn < maxTurns; turn++) {
      if (capReached()) {
        appState.send(CH.geminiStream, '\n[blocked: session cost cap reached]')
        break
      }
      const { text, calls, usage } = await this.streamOnce(apiKey, contents, { tools })
      full += text
      if (usage) {
        promptTokens += usage.promptTokens
        completionTokens += usage.completionTokens
        addUsageCost(appState.settings.geminiModel, usage.promptTokens, usage.completionTokens)
      }
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

    if (promptTokens || completionTokens) {
      appState.send(CH.usage, 'gemini', { promptTokens, completionTokens })
    }
    appState.send(CH.geminiStream, '\n[[gemini:done]]')
    return full
  }

  /** One-shot text completion — no tools, no chat streaming. For the debate moderator. */
  async complete(prompt: string, history: Message[], signal?: AbortSignal): Promise<string> {
    const apiKey = await KeychainManager.getKey()
    if (!apiKey) return '[Gemini: no API key set]'
    const contents: GeminiContent[] = history
      .filter((m) => m.content)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] }))
    contents.push({ role: 'user', parts: [{ text: prompt }] })
    return (await this.streamOnce(apiKey, contents, { emit: false, signal })).text
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
    opts: {
      emit?: boolean
      tools?: { functionDeclarations: FunctionDeclaration[] }
      signal?: AbortSignal
    } = {}
  ): Promise<{ text: string; calls: ToolCall[]; usage: { promptTokens: number; completionTokens: number } | null }> {
    const { emit = true, tools, signal } = opts
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
      body: JSON.stringify(body),
      signal
    })

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText)
      const msg = `\n[Gemini error ${res.status}: ${errText.slice(0, 500)}]`
      if (emit) appState.send(CH.geminiStream, msg)
      return { text: msg, calls: [], usage: null }
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let sseBuf = ''
    let text = ''
    let usage: { promptTokens: number; completionTokens: number } | null = null
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
          if (json?.usageMetadata) {
            usage = {
              promptTokens: json.usageMetadata.promptTokenCount ?? 0,
              completionTokens: json.usageMetadata.candidatesTokenCount ?? 0
            }
          }
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
    return { text, calls, usage }
  }
}
