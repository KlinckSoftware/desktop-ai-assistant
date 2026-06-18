import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { focusPanel } from '../dock/dockApi'

// Ctrl+P fuzzy file open. Filters the project file list; Enter/click opens the
// file in the Editor.
export default function QuickOpen({ onClose }: { onClose: () => void }): JSX.Element {
  const files = useAppStore((s) => s.fileList)
  const projectRoot = useAppStore((s) => s.projectRoot)
  const openFile = useAppStore((s) => s.openFile)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const ql = q.toLowerCase()
  const matches = (ql ? files.filter((f) => f.toLowerCase().includes(ql)) : files).slice(0, 50)

  const open = (rel: string): void => {
    const abs = `${projectRoot.replace(/[\\/]+$/, '')}/${rel}`
    openFile(abs)
    focusPanel('editor')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        className="h-fit max-h-[60vh] w-[36rem] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          placeholder="Open file…"
          className="w-full border-b border-border bg-bg px-3 py-2 text-sm outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(s + 1, matches.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (matches[sel]) open(matches[sel])
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <ul className="max-h-[50vh] overflow-auto text-xs">
          {matches.map((f, i) => (
            <li
              key={f}
              className={`cursor-pointer truncate px-3 py-1.5 ${i === sel ? 'bg-accent/20 text-white' : 'text-gray-300'}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => open(f)}
            >
              {f}
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-gray-500">No matches</li>}
        </ul>
      </div>
    </div>
  )
}
