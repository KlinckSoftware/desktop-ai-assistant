import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import type { Message } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { expandMentions } from '../utils/mentions'
import { buildContextBlock } from '../utils/context'
import MentionInput from '../components/MentionInput'
import HandoffChip from '../components/HandoffChip'

const DONE = '[[api:done]]'
const EMPTY: Message[] = [] // stable ref so the selector default doesn't churn

// A chat panel for one OpenAI-compatible provider instance. Streaming is keyed
// by instanceId so multiple API panels don't cross-talk.
export default function ApiChatPanel(props: IDockviewPanelProps): JSX.Element {
  const { instanceId, providerId } = props.params as { instanceId: string; providerId: string }
  const provider = useAppStore((s) => s.apiProviders.find((p) => p.id === providerId))
  // Model persists per panel instance (survives reopen), defaulting to the provider's.
  const model = useAppStore((s) => s.apiModels[instanceId] ?? provider?.defaultModel ?? '')
  const setModel = (m: string): void => useAppStore.getState().setApiModel(instanceId, m)
  // Messages live in the store (keyed by instanceId) so the thread persists
  // across panel close + app restart.
  const messages = useAppStore((s) => s.apiChats[instanceId] ?? EMPTY)
  const setMessages = (next: Message[]): void => useAppStore.getState().setApiChat(instanceId, next)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [needKey, setNeedKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const poolSize = useAppStore((s) => s.contextFiles.size)
  const repoMap = useAppStore((s) => s.repoMapInContext)
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
        useAppStore.getState().updateFleet(instanceId, { status: 'idle' })
        const clean = chunk.replace(DONE, '')
        if (clean) {
          appendLast(clean)
          useAppStore.getState().bumpFleet(instanceId, clean.length)
        }
        return
      }
      appendLast(chunk)
      useAppStore.getState().bumpFleet(instanceId, chunk.length)
    })
    return off
  }, [instanceId])

  // Register with the cockpit fleet while mounted.
  useEffect(() => {
    if (!provider) return
    useAppStore.getState().registerFleet({
      id: instanceId,
      name: provider.name,
      kind: 'api',
      model: model || provider.defaultModel,
      status: 'idle',
      chars: 0,
      promptTokens: 0,
      completionTokens: 0,
      lastTs: Date.now()
    })
    return () => useAppStore.getState().removeFleet(instanceId)
  }, [instanceId, provider])

  useEffect(() => {
    useAppStore.getState().updateFleet(instanceId, { model: model || provider?.defaultModel })
  }, [model, instanceId, provider])

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  const appendLast = (chunk: string): void => {
    const ms = useAppStore.getState().apiChats[instanceId] ?? []
    const next = [...ms]
    const last = next[next.length - 1]
    if (last && last.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + chunk }
    useAppStore.getState().setApiChat(instanceId, next)
  }

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
    const st = useAppStore.getState()
    const ctx = await buildContextBlock([...st.contextFiles], st.repoMapInContext)
    const turn = ctx ? `${ctx}\n\n---\n\n${expanded}` : expanded
    const history: Message[] = [...messages, { role: 'user', content: turn }]
    setMessages([...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setBusy(true)
    useAppStore.getState().updateFleet(instanceId, { status: 'busy' })
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
          className="w-44 rounded border border-border bg-panel px-2 py-0.5 text-[11px] outline-none focus:border-accent"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list={`models-${instanceId}`}
          title="Model (pick a suggestion or type any id)"
          placeholder={provider.defaultModel}
        />
        <datalist id={`models-${instanceId}`}>
          {(provider.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
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
                {m.role === 'assistant' && m.content && !busy && (
                  <div className="mt-0.5">
                    <button
                      className="text-[10px] text-gray-500 hover:text-accent"
                      onClick={() => useAppStore.getState().setHandoff(m.content, provider.name)}
                      title="Park this reply for another agent to pick up"
                    >
                      → handoff
                    </button>
                  </div>
                )}
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
          <HandoffChip self={provider.name} onInsert={(t) => setInput((v) => (v ? `${v}\n\n${t}` : t))} />
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
