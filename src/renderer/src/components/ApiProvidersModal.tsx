import { useState } from 'react'
import type { ApiProvider } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

const blank: ApiProvider = { id: '', name: '', baseUrl: '', defaultModel: '' }

export default function ApiProvidersModal({ onClose }: { onClose: () => void }): JSX.Element {
  const providers = useAppStore((s) => s.apiProviders)
  const setProviders = useAppStore((s) => s.setApiProviders)
  const [form, setForm] = useState<ApiProvider>(blank)
  const [editing, setEditing] = useState(false)
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')

  const edit = (p: ApiProvider): void => {
    setForm({ ...p })
    setEditing(true)
  }
  const reset = (): void => {
    setForm(blank)
    setEditing(false)
  }
  const save = async (): Promise<void> => {
    if (!form.id.trim() || !form.baseUrl.trim()) return
    setProviders(await window.api.api.saveProvider({ ...form, id: form.id.trim() }))
    reset()
  }
  const remove = async (id: string): Promise<void> => setProviders(await window.api.api.removeProvider(id))
  const saveKey = async (id: string): Promise<void> => {
    if (!keyInput.trim()) return
    await window.api.api.saveKey(id, keyInput.trim())
    setKeyInput('')
    setKeyFor(null)
    setProviders(await window.api.api.providers())
  }

  return (
    <div style={{ zIndex: Z.modal }} className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-[36rem] flex-col rounded-lg border border-border bg-panel p-5 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-accent">API providers</h2>
          <button aria-label="Close" className="text-gray-400 hover:text-gray-200" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="mb-4 max-h-56 overflow-auto rounded border border-border">
          {providers.map((p) => (
            <div key={p.id} className="border-b border-border/50 px-2 py-1.5 last:border-0">
              <div className="flex items-center gap-2">
                <span
                  className={p.hasKey ? 'text-green-400' : 'text-red-400'}
                  title={p.noKey ? 'no key needed' : p.hasKey ? 'key set' : 'no key'}
                >
                  ●
                </span>
                <span className="text-gray-200">{p.name}</span>
                <span className="truncate font-mono text-[11px] text-gray-500">{p.baseUrl}</span>
                {p.builtin && <span className="text-[10px] text-gray-600">built-in</span>}
                <div className="ml-auto flex gap-1">
                  {!p.noKey && (
                    <button className="rounded px-1.5 text-gray-400 hover:bg-bg" onClick={() => setKeyFor(p.id)}>
                      key
                    </button>
                  )}
                  <button className="rounded px-1.5 text-gray-400 hover:bg-bg" onClick={() => edit(p)}>
                    edit
                  </button>
                  <button className="rounded px-1.5 text-gray-400 hover:bg-bg" onClick={() => remove(p.id)}>
                    {p.builtin ? 'revert' : 'remove'}
                  </button>
                </div>
              </div>
              {keyFor === p.id && (
                <div className="mt-1 flex gap-1">
                  <input
                    type="password"
                    autoFocus
                    className="flex-1 rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                    placeholder={`${p.name} API key`}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveKey(p.id)}
                  />
                  <button className="rounded bg-gemini px-2 text-xs text-white" onClick={() => saveKey(p.id)}>
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="text-xs uppercase text-gray-500">{editing ? `Edit ${form.id}` : 'Add provider'}</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input className="rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent disabled:opacity-50" placeholder="id" value={form.id} disabled={editing} onChange={(e) => setForm({ ...form, id: e.target.value })} />
          <input className="rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent" placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="col-span-2 rounded border border-border bg-bg px-2 py-1 font-mono text-xs outline-none focus:border-accent" placeholder="base URL (…/v1)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          <input className="col-span-2 rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent" placeholder="default model" value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <label className="flex items-center gap-1 text-xs text-gray-400">
            <input type="checkbox" checked={!!form.noKey} onChange={(e) => setForm({ ...form, noKey: e.target.checked })} />
            no key (local)
          </label>
          <div className="flex gap-2">
            {editing && (
              <button className="rounded px-3 py-1 text-gray-400" onClick={reset}>
                Cancel
              </button>
            )}
            <button
              className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
              disabled={!form.id.trim() || !form.baseUrl.trim()}
              onClick={save}
            >
              {editing ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">OpenAI-compatible /chat/completions endpoints. Keys stored in the OS keychain.</p>
      </div>
    </div>
  )
}
