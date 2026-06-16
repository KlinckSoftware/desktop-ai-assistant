import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { expandMentions } from '../utils/mentions'
import MentionInput from '../components/MentionInput'

const DONE = '[[gemini:done]]'

export default function GeminiChat(): JSX.Element {
  const messages = useAppStore((s) => s.geminiMessages)
  const addMessage = useAppStore((s) => s.addGeminiMessage)
  const append = useAppStore((s) => s.appendToLastGemini)
  const hasKey = useAppStore((s) => s.hasGeminiKey)
  const hasContext = useAppStore((s) => s.pendingGeminiContext.length > 0)
  const setPendingContext = useAppStore((s) => s.setPendingGeminiContext)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = window.api.gemini.onStream((chunk) => {
      if (chunk.includes(DONE)) {
        setBusy(false)
        const clean = chunk.replace(DONE, '')
        if (clean) append(clean)
        return
      }
      append(chunk)
    })
    return off
  }, [append])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  const sendMsg = async (): Promise<void> => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const history = useAppStore.getState().geminiMessages
    // Expand @path mentions, then prepend any attached file context (consumed
    // once). The chat bubble keeps the clean typed text.
    const root = useAppStore.getState().projectRoot
    const withMentions = await expandMentions(text, root)
    const ctx = useAppStore.getState().pendingGeminiContext
    const augmented = ctx ? `${ctx}\n\n---\n\n${withMentions}` : withMentions
    if (ctx) useAppStore.getState().setPendingGeminiContext('')
    addMessage({ role: 'user', content: text })
    addMessage({ role: 'model', content: '' })
    setBusy(true)
    await window.api.gemini.send(augmented, history)
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="border-b border-border px-3 py-1.5 text-xs font-semibold text-gemini">
        ✦ Gemini {!hasKey && <span className="text-red-400">(no API key)</span>}
      </div>
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
      {hasContext && (
        <div className="flex items-center justify-between border-t border-border bg-gemini/10 px-3 py-1 text-[11px] text-gemini">
          <span>✦ file context attached — sent with next message</span>
          <button className="text-gray-400 hover:text-gray-200" onClick={() => setPendingContext('')}>
            clear
          </button>
        </div>
      )}
      <div className="flex gap-2 border-t border-border p-2">
        <MentionInput
          value={input}
          onChange={setInput}
          onSubmit={sendMsg}
          disabled={!hasKey}
          placeholder={hasKey ? 'Ask Gemini…  (@path to attach a file)' : 'Set an API key first'}
        />
        <button
          className="rounded bg-gemini px-3 text-sm font-medium text-white disabled:opacity-40"
          disabled={!hasKey || busy}
          onClick={sendMsg}
        >
          Send
        </button>
      </div>
    </div>
  )
}
