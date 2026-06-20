import { useState } from 'react'
import type { AgentDef } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

// Shown when launching an agent whose command isn't found on PATH. Lets the
// user point at the right binary (or read install steps), then retry.
export default function AgentSetupModal({
  agent,
  onClose,
  onReady
}: {
  agent: AgentDef
  onClose: () => void
  onReady: (a: AgentDef) => void
}): JSX.Element {
  const setAgents = useAppStore((s) => s.setAgents)
  const [command, setCommand] = useState(agent.command)
  const [msg, setMsg] = useState('')

  const saveRetry = async (): Promise<void> => {
    const list = await window.api.agent.save({ ...agent, command: command.trim() })
    setAgents(list)
    const updated = list.find((a) => a.id === agent.id)
    if (updated?.available) {
      onReady(updated)
      onClose()
    } else {
      setMsg('Still not found on PATH. Use a full path, or install it (below).')
    }
  }

  return (
    <div style={{ zIndex: Z.modal }} className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
      <div className="w-[30rem] rounded-lg border border-border bg-panel p-5 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-accent">Set up {agent.name}</h2>
          <button aria-label="Close" className="text-gray-400 hover:text-gray-200" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="mb-3 text-gray-300">
          <span className="font-mono text-red-300">{agent.command}</span> isn&apos;t on your PATH.
          Install it, or point at the binary directly.
        </p>

        {agent.installHint && (
          <pre className="mb-3 whitespace-pre-wrap rounded bg-bg p-2 text-xs text-gray-300">
            {agent.installHint}
          </pre>
        )}
        {agent.docsUrl && (
          <button
            className="mb-3 text-xs text-accent hover:underline"
            onClick={() => window.api.openExternal(agent.docsUrl as string)}
          >
            Open docs →
          </button>
        )}

        <label className="mb-1 block text-xs uppercase text-gray-500">Command / full path</label>
        <input
          className="mb-1 w-full rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs outline-none focus:border-accent"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveRetry()}
        />
        {msg && <div className="mb-1 text-xs text-red-400">{msg}</div>}

        <div className="mt-3 flex justify-end gap-2">
          <button className="rounded px-3 py-1 text-gray-400" onClick={onClose}>
            Cancel
          </button>
          <button className="rounded bg-accent px-3 py-1 font-medium text-black" onClick={saveRetry}>
            Save &amp; retry
          </button>
        </div>
      </div>
    </div>
  )
}
