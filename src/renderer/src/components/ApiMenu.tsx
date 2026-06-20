import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'
import { openApiChat } from '../dock/apichat'
import ApiProvidersModal from './ApiProvidersModal'

// Top-bar launcher for OpenAI-compatible API chat instances (each its own panel).
export default function ApiMenu(): JSX.Element {
  const providers = useAppStore((s) => s.apiProviders)
  const [open, setOpen] = useState(false)
  const [manage, setManage] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg" onClick={() => setOpen((o) => !o)}>
        ＋ API ▾
      </button>
      {open && (
        <div
          style={{ zIndex: Z.dropdown }}
          className="absolute left-0 top-full mt-1 w-52 rounded border border-border bg-panel py-1 text-xs shadow-xl"
        >
          <div className="px-3 py-1 text-[10px] uppercase text-gray-500">New API chat</div>
          {providers.map((p) => (
            <button
              key={p.id}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg"
              onClick={() => {
                setOpen(false)
                openApiChat(p.id)
              }}
            >
              <span className={p.hasKey ? 'text-green-400' : 'text-gray-600'}>●</span>
              {p.name}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            className="block w-full px-3 py-1.5 text-left text-gray-400 hover:bg-bg"
            onClick={() => {
              setOpen(false)
              setManage(true)
            }}
          >
            Add / manage providers…
          </button>
        </div>
      )}
      {manage && <ApiProvidersModal onClose={() => setManage(false)} />}
    </div>
  )
}
