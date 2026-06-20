import { useAppStore } from '../store/appStore'

// Destination-side chip for agent handoff. Shows when another agent has parked
// a reply in the handoff buffer; clicking inserts it here. Hidden when the
// parked reply came from this same agent (no point handing off to yourself).
export default function HandoffChip({
  self,
  onInsert,
  insertLabel = 'insert'
}: {
  self: string
  onInsert: (text: string) => void
  insertLabel?: string
}): JSX.Element | null {
  const handoff = useAppStore((s) => s.handoff)
  const clearHandoff = useAppStore((s) => s.clearHandoff)
  if (!handoff || handoff.from === self) return null
  const preview = handoff.text.replace(/\s+/g, ' ').slice(0, 70)
  return (
    <div className="flex items-center gap-2 border-t border-border bg-accent/10 px-3 py-1 text-[11px] text-accent">
      <span className="flex-1 truncate" title={handoff.text}>
        ↘ handoff from {handoff.from}: {preview}…
      </span>
      <button className="font-medium hover:underline" onClick={() => onInsert(handoff.text)}>
        {insertLabel}
      </button>
      <button className="text-gray-500 hover:text-gray-300" onClick={clearHandoff} aria-label="Dismiss handoff">
        ✕
      </button>
    </div>
  )
}
