import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { expandMentions } from '../utils/mentions'
import { buildContextBlock } from '../utils/context'
import MentionInput from '../components/MentionInput'

const DONE = '[[gemini:done]]'

export default function GeminiChat(): JSX.Element {
  const messages = useAppStore((s) => s.geminiMessages)
  const addMessage = useAppStore((s) => s.addGeminiMessage)
  const append = useAppStore((s) => s.appendToLastGemini)
  const hasKey = useAppStore((s) => s.hasGeminiKey)
  const poolSize = useAppStore((s) => s.contextFiles.size)
  const repoMap = useAppStore((s) => s.repoMapInContext)
  const attachments = useAppStore((s) => s.attachments)
  const removeAttachment = useAppStore((s) => s.removeAttachment)
  const clearAttachments = useAppStore((s) => s.clearAttachments)
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
    const atts = useAppStore.getState().attachments
    if ((!text && atts.length === 0) || busy) return
    setInput('')
    const history = useAppStore.getState().geminiMessages
    const root = useAppStore.getState().projectRoot

    // Inline dropped text files as context.
    const textAtts = atts.filter((a) => a.kind === 'text')
    const attachedText = (
      await Promise.all(
        textAtts.map(async (a) => {
          try {
            const content = await window.api.fs.readDropped(a.path)
            return `### File: ${a.name} (${a.path})\n\`\`\`\n${content}\n\`\`\``
          } catch {
            return `### File: ${a.name}\n[unreadable]`
          }
        })
      )
    ).join('\n\n')

    const images = atts
      .filter((a) => a.kind === 'image' && a.base64 && a.mime)
      .map((a) => ({ mime: a.mime as string, base64: a.base64 as string }))

    const withMentions = await expandMentions(text, root)
    const st = useAppStore.getState()
    const ctx = await buildContextBlock([...st.contextFiles], st.repoMapInContext)
    const augmented = [ctx, attachedText, withMentions].filter(Boolean).join('\n\n---\n\n')
    clearAttachments()

    const label =
      text || (atts.length ? `[${atts.length} attachment(s)]` : '')
    addMessage({ role: 'user', content: label })
    addMessage({ role: 'model', content: '' })
    setBusy(true)
    await window.api.gemini.send(augmented, history, images)
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
      {(poolSize > 0 || repoMap) && (
        <div className="flex items-center justify-between border-t border-border bg-gemini/10 px-3 py-1 text-[11px] text-gemini">
          <span>
            ◆ shared context: {poolSize > 0 && `${poolSize} file(s)`}
            {poolSize > 0 && repoMap && ' + '}
            {repoMap && 'repo map'}
          </span>
          <button
            className="text-gray-400 hover:text-gray-200"
            onClick={() => useAppStore.getState().clearContextFiles()}
          >
            clear
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-2 py-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="flex items-center gap-1 rounded-full border border-border bg-bg px-2 py-0.5 text-[11px] text-gray-300"
              title={a.path}
            >
              <span>{a.kind === 'image' ? '🖼' : '📄'}</span>
              <span className="max-w-[140px] truncate">{a.name}</span>
              <button className="text-gray-500 hover:text-red-400" onClick={() => removeAttachment(a.id)}>
                ✕
              </button>
            </span>
          ))}
          <button className="px-1 text-[11px] text-gray-500 hover:text-gray-300" onClick={clearAttachments}>
            clear all
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
