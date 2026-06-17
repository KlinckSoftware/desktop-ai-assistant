import { useCallback, useEffect, useState } from 'react'
import type { Checkpoint } from '@shared/types'

// Pre-edit snapshots taken before each applied agent edit. Undo restores the
// prior file content. Newest first.
export default function CheckpointsPanel(): JSX.Element {
  const [items, setItems] = useState<Checkpoint[]>([])

  const refresh = useCallback(() => {
    window.api.checkpoint.list().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
    return window.api.checkpoint.onChanged(refresh)
  }, [refresh])

  return (
    <div className="flex h-full flex-col bg-bg text-xs">
      <div className="border-b border-border px-3 py-1.5 font-semibold text-accent">
        Checkpoints ({items.length})
      </div>
      <div className="flex-1 overflow-auto">
        {items.length === 0 && (
          <div className="p-3 text-gray-500">
            No checkpoints yet. One is saved before each applied agent file-edit.
          </div>
        )}
        {items.map((c) => (
          <div key={c.id} className="flex items-center gap-2 border-b border-border/50 px-2 py-1">
            <span className="flex-1 truncate text-gray-300" title={c.path}>
              {c.label}
            </span>
            <button
              className="rounded border border-border px-2 py-0.5 text-gray-300 hover:bg-panel"
              onClick={() => window.api.checkpoint.undo(c.id)}
              title="Restore the file to its pre-edit content"
            >
              undo
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
