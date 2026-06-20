import { appState } from '../state'
import { CH, type Message } from '../../shared/types'
import { getProvider, getKey } from './providers'

const DONE = '[[api:done]]'

// Streams an OpenAI-compatible /chat/completions response to the renderer,
// tagged with instanceId so the right API-chat panel receives it.
export async function apiSend(
  instanceId: string,
  providerId: string,
  model: string,
  history: Message[]
): Promise<void> {
  const emit = (chunk: string): void => appState.send(CH.apiStream, instanceId, chunk)
  const provider = await getProvider(providerId)
  if (!provider) {
    emit(`\n[API: unknown provider ${providerId}]` + DONE)
    return
  }
  const key = provider.noKey ? '' : await getKey(providerId)
  if (!provider.noKey && !key) {
    emit(`\n[API: no key set for ${provider.name}]` + DONE)
    return
  }

  const messages = history
    .filter((m) => m.content)
    .map((m) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content }))

  try {
    const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {})
      },
      body: JSON.stringify({ model, messages, stream: true })
    })
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText)
      emit(`\n[API error ${res.status}: ${errText.slice(0, 500)}]` + DONE)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
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
          const json = JSON.parse(payload)
          const chunk = json?.choices?.[0]?.delta?.content
          if (chunk) emit(chunk)
        } catch {
          /* partial frame */
        }
      }
    }
    emit(DONE)
  } catch (err) {
    emit(`\n[API request failed: ${err instanceof Error ? err.message : String(err)}]` + DONE)
  }
}
