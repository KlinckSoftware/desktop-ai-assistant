import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { Message } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { expandMentions } from '../utils/mentions'
import MentionInput from '../components/MentionInput'

const DONE = '[[api:done]]'

// A chat panel for one OpenAI-compatible provider instance. Streaming is keyed
// by instanceId so multiple API panels don't cross-talk.
export default function ApiChatPanel(props: IDockviewPanelProps): JSX.Element {
  const { instanceId, providerId } = props.params as { instanceId: string; providerId: string }
  const provider = useAppStore((s) => s.apiProviders.find((p) => p.id === providerId))
  const [model, setModel] = useState(provider?.defaultModel ?? '')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [needKey, setNeedKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!provider) return
    window.api.api.hasKey(provider.id).then((has) => setNeedKey(!has && !provider.noKey))
  }, [provider])

  useEffect(() => {
    const off = window.api.api.onStream((sid, chunk) => {
      if (sid !== instanceId) return
      if (chunk.includes(DONE)) {
        setBusy(false)
        const clean = chunk.replace(DONE, '')
        if (clean) appendLast(clean)
        return
      }
      appendLast(chunk)
    })
    return off
  }, [instanceId])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  const appendLast = (chunk: string): void =>
    setMessages((ms) => {
      const next = [...ms]
      const last = next[next.length - 1]
      if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + chunk }
      return next
    })

  const saveKey = async (): Promise<void> => {
    if (!keyInput.trim() || !provider) return
    await window.api.api.saveKey(provider.id, keyInput.trim())
    setKeyInput('')
    setNeedKey(false)
  }

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || busy || !provider) return
    setInput('')
    const root = useAppStore.getState().projectRoot
    const expanded = await expandMentions(text, root)
    const history: Message[] = [...messages, { role: 'user', content: expanded }]
    setMessages([...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setBusy(true)
    await window.api.api.send(instanceId, provider.id, model || provider.defaultModel, history)
  }

  if (!provider) {
    return <div className="flex h-full items-center justify-center bg-bg text-sm text-gray-500">Unknown provider</div>
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold text-gemini">✦ {provider.name}</span>
        <input
          className="w-40 rounded border border-border bg-panel px-2 py-0.5 text-[11px] outline-none focus:border-accent"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          title="Model"
        />
      </div>

      {needKey ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-sm">
          <div className="text-gray-400">{provider.name} needs an API key.</div>
          <input
            type="password"
            className="w-64 rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent"
            placeholder="API key"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          />
          <div className="flex gap-2">
            <button className="rounded bg-gemini px-3 py-1 text-xs font-medium text-white" onClick={saveKey}>
              Save key
            </button>
            {provider.docsUrl && (
              <button
                className="rounded border border-border px-3 py-1 text-xs text-gray-300"
                onClick={() => window.api.openExternal(provider.docsUrl as string)}
              >
                Get a key →
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                <div
                  className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left ${
                    m.role === 'user' ? 'bg-gemini/20' : 'bg-panel'
                  }`}
                >
                  {m.content || (busy && i === messages.length - 1 ? '…' : '')}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 border-t border-border p-2">
            <MentionInput
              value={input}
              onChange={setInput}
              onSubmit={send}
              placeholder="Ask…  (@path to attach a file)"
            />
            <button
              className="rounded bg-gemini px-3 text-sm font-medium text-white disabled:opacity-40"
              disabled={busy}
              onClick={send}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  )
}
