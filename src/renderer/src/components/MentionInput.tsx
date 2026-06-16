import { useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../store/appStore'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  rows?: number
  className?: string
}

// Textarea with @path autocomplete. Typing "@" followed by non-space chars
// opens a dropdown of matching project files; selecting one inserts "@path ".
export default function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  rows = 2,
  className = ''
}: Props): JSX.Element {
  const files = useAppStore((s) => s.fileList)
  const ref = useRef<HTMLTextAreaElement>(null)
  const [open, setOpen] = useState(false)
  const [matches, setMatches] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [tokenStart, setTokenStart] = useState(-1)

  // Find an active "@token" ending at the caret (no whitespace in the token).
  const recompute = (text: string, caret: number): void => {
    const upto = text.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) return close()
    const token = upto.slice(at + 1)
    if (/\s/.test(token)) return close()
    const q = token.toLowerCase()
    const hits = files.filter((f) => f.toLowerCase().includes(q)).slice(0, 8)
    if (hits.length === 0) return close()
    setMatches(hits)
    setSel(0)
    setTokenStart(at)
    setOpen(true)
  }

  const close = (): void => {
    setOpen(false)
    setMatches([])
    setTokenStart(-1)
  }

  const choose = (file: string): void => {
    if (tokenStart < 0) return
    const caret = ref.current?.selectionStart ?? value.length
    const next = value.slice(0, tokenStart) + '@' + file + ' ' + value.slice(caret)
    onChange(next)
    close()
    // Restore focus; caret lands after the inserted mention.
    requestAnimationFrame(() => {
      const pos = tokenStart + file.length + 2
      ref.current?.focus()
      ref.current?.setSelectionRange(pos, pos)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSel((s) => (s + 1) % matches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSel((s) => (s - 1 + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(matches[sel])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="relative flex-1">
      {open && (
        <ul className="absolute bottom-full z-50 mb-1 max-h-56 w-full overflow-auto rounded border border-border bg-panel text-xs shadow-xl">
          {matches.map((f, i) => (
            <li
              key={f}
              className={`cursor-pointer truncate px-2 py-1 ${i === sel ? 'bg-gemini/30 text-white' : 'text-gray-300'}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(f)
              }}
            >
              {f}
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={ref}
        className={`w-full resize-none rounded border border-border bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50 ${className}`}
        rows={rows}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value)
          recompute(e.target.value, e.target.selectionStart)
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(close, 120)}
      />
    </div>
  )
}
