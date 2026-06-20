import { useEffect, useRef, useState } from 'react'
import { PANELS, getDockApi, togglePanel, resetLayout } from '../dock/dockApi'
import { Z } from '../zIndex'

// Toggle panels open/closed (closed ones reopen at a default spot). Lets the
// user reopen anything they collapsed and confirm what's currently shown.
export default function ViewMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const openIds = new Set((getDockApi()?.panels ?? []).map((p) => p.id))

  return (
    <div ref={ref} className="relative">
      <button
        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
        onClick={() => setOpen((o) => !o)}
      >
        View ▾
      </button>
      {open && (
        <div
          style={{ zIndex: Z.dropdown }}
          className="absolute left-0 top-full mt-1 w-48 rounded border border-border bg-panel py-1 text-xs shadow-xl"
        >
          {PANELS.map((p) => (
            <button
              key={p.id}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-bg"
              onClick={() => {
                togglePanel(p.id)
                setOpen(false)
              }}
            >
              <span className="w-3 text-accent">{openIds.has(p.id) ? '✓' : ''}</span>
              {p.title}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            className="block w-full px-3 py-1.5 text-left text-gray-400 hover:bg-bg"
            onClick={() => {
              resetLayout()
              setOpen(false)
            }}
          >
            Reset layout
          </button>
        </div>
      )}
    </div>
  )
}
