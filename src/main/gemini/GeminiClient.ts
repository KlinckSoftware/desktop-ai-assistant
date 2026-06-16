import { appState } from '../state'
import { CH, type Message } from '../../shared/types'
import { KeychainManager } from '../keychain/KeychainManager'
import { extractBashBlocks } from '../executor/parser'
import type { CommandBroker } from '../executor/CommandBroker'

const MODEL = 'gemini-2.5-flash'
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

const SYSTEM = `You are an expert coding assistant working inside a desktop IDE.
When you want to run a terminal command, output it in a fenced block exactly like:
\`\`\`bash run
your command here
\`\`\`
The command runs on the user's machine after they approve it, and you receive the
output back. Use this to inspect files, run builds, and verify your work.`

interface GeminiPart {
  text?: string
}
interface GeminiContent {
  role: string
  parts: GeminiPart[]
}

export class GeminiClient {
  constructor(private broker: CommandBroker) {}

  async hasKey(): Promise<boolean> {
    return KeychainManager.hasKey()
  }

  async saveKey(key: string): Promise<void> {
    await KeychainManager.setKey(key.trim())
  }

  /**
   * Streams a Gemini response to the renderer (CH.geminiStream).
   * Runs a bounded agentic loop: if the model emits ```bash run``` blocks, they
   * are routed through the approval broker and the outputs fed back for up to
   * `maxTurns` iterations.
   */
  async send(prompt: string, history: Message[], maxTurns = 5): Promise<string> {
    const apiKey = await KeychainManager.getKey()
    if (!apiKey) {
      appState.send(CH.geminiStream, '\n[Gemini: no API key set. Add one in settings.]')
      return ''
    }

    const contents: GeminiContent[] = history
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }]
      }))
    contents.push({ role: 'user', parts: [{ text: prompt }] })

    let full = ''
    for (let turn = 0; turn < maxTurns; turn++) {
      const text = await this.streamOnce(apiKey, contents)
      full += text
      contents.push({ role: 'model', parts: [{ text }] })

      const cmds = extractBashBlocks(text)
      if (cmds.length === 0) break

      const results = await Promise.all(
        cmds.map((cmd) => this.broker.propose(cmd, 'gemini', 'gemini-main'))
      )
      const feedback = cmds
        .map((cmd, i) => `$ ${cmd}\n${results[i]}`)
        .join('\n\n')
      appState.send(CH.geminiStream, `\n\n_[ran ${cmds.length} command(s)]_\n\n`)
      contents.push({ role: 'user', parts: [{ text: `Command output:\n\`\`\`\n${feedback}\n\`\`\`` }] })
    }

    appState.send(CH.geminiStream, '\n[[gemini:done]]')
    return full
  }

  /** One-shot text completion — no command loop, no chat streaming. For the debate moderator. */
  async complete(prompt: string, history: Message[]): Promise<string> {
    const apiKey = await KeychainManager.getKey()
    if (!apiKey) return '[Gemini: no API key set]'
    const contents: GeminiContent[] = history
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }]
      }))
    contents.push({ role: 'user', parts: [{ text: prompt }] })
    // emit=false: debate turns must not leak into the main Gemini chat stream.
    return this.streamOnce(apiKey, contents, false)
  }

  /**
   * Isolated single-turn call for the SideChat overlay. Does NOT stream to the
   * main chat channel and does NOT run the command/approval loop — returns the
   * full reply text via the invoke result only.
   */
  async sideSend(prompt: string): Promise<string> {
    const apiKey = await KeychainManager.getKey()
    if (!apiKey) return '[Gemini: no API key set]'
    const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }]
    return this.streamOnce(apiKey, contents, false)
  }

  /**
   * One streaming generateContent call. Uses alt=sse for real SSE framing.
   * When `emit` is true, chunks are pushed to the main Gemini chat channel.
   * Side/debate callers pass false so they never touch the main chat stream.
   */
  private async streamOnce(apiKey: string, contents: GeminiContent[], emit = true): Promise<string> {
    // Key goes in a header, not the query string — keeps the secret out of
    // request lines / proxy logs.
    const url = `${BASE}/${MODEL}:streamGenerateContent?alt=sse`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM }] }
      })
    })

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText)
      const msg = `\n[Gemini error ${res.status}: ${errText.slice(0, 500)}]`
      if (emit) appState.send(CH.geminiStream, msg)
      return msg
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let sseBuf = ''
    let text = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      sseBuf += decoder.decode(value, { stream: true })

      // SSE events are separated by blank lines; data lines start with "data: ".
      let nl: number
      while ((nl = sseBuf.indexOf('\n')) >= 0) {
        const line = sseBuf.slice(0, nl).trim()
        sseBuf = sseBuf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const chunk = json?.candidates?.[0]?.content?.parts?.[0]?.text
          if (chunk) {
            text += chunk
            if (emit) appState.send(CH.geminiStream, chunk)
          }
        } catch {
          /* partial JSON — alt=sse should prevent this, but be safe */
        }
      }
    }
    return text
  }
}
