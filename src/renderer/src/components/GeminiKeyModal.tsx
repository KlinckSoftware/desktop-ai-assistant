import { useState } from 'react'
import { useAppStore } from '../store/appStore'

export default function GeminiKeyModal({ onClose }: { onClose: () => void }): JSX.Element {
  const setHasKey = useAppStore((s) => s.setHasGeminiKey)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (!key.trim()) return
    setSaving(true)
    await window.api.gemini.saveKey(key.trim())
    setHasKey(true)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[28rem] rounded-lg border border-border bg-panel p-5">
        <h2 className="mb-1 text-lg font-semibold text-gemini">Gemini API Key</h2>
        <p className="mb-3 text-xs text-gray-400">
          Stored in your OS keychain via keytar. Get a free key at{' '}
          <span className="text-accent">aistudio.google.com/apikey</span>.
        </p>
        <input
          type="password"
          className="mb-3 w-full rounded border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          placeholder="AIza…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <div className="flex justify-end gap-2 text-sm">
          <button className="rounded px-3 py-1 text-gray-400" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-gemini px-3 py-1 font-medium text-white disabled:opacity-40"
            disabled={saving}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
