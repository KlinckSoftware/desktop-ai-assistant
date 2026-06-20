import { useState } from 'react'
import type { AgentDef } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

const blank: AgentDef = { id: '', name: '', command: '', args: [] }

export default function AgentsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const agents = useAppStore((s) => s.agents)
  const setAgents = useAppStore((s) => s.setAgents)
  const [form, setForm] = useState<AgentDef>(blank)
  const [argsText, setArgsText] = useState('')
  const [editing, setEditing] = useState(false)

  const edit = (a: AgentDef): void => {
    setForm({ id: a.id, name: a.name, command: a.command, args: a.args, installHint: a.installHint, docsUrl: a.docsUrl })
    setArgsText((a.args ?? []).join(' '))
    setEditing(true)
  }
  const reset = (): void => {
    setForm(blank)
    setArgsText('')
    setEditing(false)
  }

  const save = async (): Promise<void> => {
    const id = form.id.trim()
    if (!id || !form.command.trim()) return
    const def: AgentDef = {
      id,
      name: form.name.trim() || id,
      command: form.command.trim(),
      args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      installHint: form.installHint?.trim() || undefined,
      docsUrl: form.docsUrl?.trim() || undefined
    }
    setAgents(await window.api.agent.save(def))
    reset()
  }

  const remove = async (id: string): Promise<void> => {
    setAgents(await window.api.agent.remove(id))
  }

  return (
    <div style={{ zIndex: Z.modal }} className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-[34rem] flex-col rounded-lg border border-border bg-panel p-5 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-accent">Agents</h2>
          <button aria-label="Close" className="text-gray-400 hover:text-gray-200" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="mb-4 max-h-48 overflow-auto rounded border border-border">
          {agents.map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-b border-border/50 px-2 py-1.5 last:border-0">
              <span className={a.available ? 'text-green-400' : 'text-red-400'} title={a.available ? 'available' : 'not found'}>
                ●
              </span>
              <span className="text-gray-200">{a.name}</span>
              <span className="truncate font-mono text-[11px] text-gray-500">{a.command}</span>
              {a.builtin && <span className="text-[10px] text-gray-600">built-in</span>}
              <div className="ml-auto flex gap-1">
                <button className="rounded px-1.5 text-gray-400 hover:bg-bg" onClick={() => edit(a)}>
                  edit
                </button>
                <button
                  className="rounded px-1.5 text-gray-400 hover:bg-bg"
                  onClick={() => remove(a.id)}
                  title={a.builtin ? 'Revert to built-in default' : 'Remove'}
                >
                  {a.builtin ? 'revert' : 'remove'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs uppercase text-gray-500">{editing ? `Edit ${form.id}` : 'Add agent'}</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            className="rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent disabled:opacity-50"
            placeholder="id (e.g. aider)"
            value={form.id}
            disabled={editing}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
          />
          <input
            className="rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
            placeholder="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
            placeholder="command (on PATH or full path)"
            value={form.command}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
          />
          <input
            className="rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
            placeholder="args (space-separated)"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          {editing && (
            <button className="rounded px-3 py-1 text-gray-400" onClick={reset}>
              Cancel
            </button>
          )}
          <button
            className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
            disabled={!form.id.trim() || !form.command.trim()}
            onClick={save}
          >
            {editing ? 'Save' : 'Add'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">
          Agents run as interactive terminal sessions. A red dot = command not found on PATH.
        </p>
      </div>
    </div>
  )
}
