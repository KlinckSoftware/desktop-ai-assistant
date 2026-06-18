import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'

interface McpStatus {
  server: string
  connected: boolean
  toolCount: number
  error?: string
}

const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
]

export default function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const geminiModel = useAppStore((s) => s.geminiModel)
  const debateRounds = useAppStore((s) => s.debateRounds)
  const terminalShell = useAppStore((s) => s.terminalShell)
  const setGeminiModel = useAppStore((s) => s.setGeminiModel)
  const setDebateRounds = useAppStore((s) => s.setDebateRounds)
  const setTerminalShell = useAppStore((s) => s.setTerminalShell)
  const trustedCount = useAppStore((s) => s.trustedSessions.size)
  const clearTrust = useAppStore((s) => s.clearTrust)
  const hasKey = useAppStore((s) => s.hasGeminiKey)
  const setHasKey = useAppStore((s) => s.setHasGeminiKey)

  const [key, setKey] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [mcp, setMcp] = useState<McpStatus[]>([])
  const [mcpPath, setMcpPath] = useState('')
  const [mcpBusy, setMcpBusy] = useState(false)

  useEffect(() => {
    window.api.mcp.status().then(setMcp)
    window.api.mcp.configPath().then(setMcpPath)
  }, [])

  const reconnectMcp = async (): Promise<void> => {
    setMcpBusy(true)
    setMcp(await window.api.mcp.reconnect())
    setMcpBusy(false)
  }

  const onModel = (m: string): void => {
    setGeminiModel(m)
    window.api.settings.set({ geminiModel: m })
  }
  const onRounds = (n: number): void => {
    const v = Math.min(5, Math.max(1, n))
    setDebateRounds(v)
    window.api.settings.set({ debateRounds: v })
  }
  const onShell = (s: typeof terminalShell): void => {
    setTerminalShell(s)
    window.api.settings.set({ terminalShell: s }) // main respawns the terminal shell
  }
  const SHELLS: typeof terminalShell[] = ['default', 'powershell', 'pwsh', 'cmd', 'bash', 'zsh']
  const saveKey = async (): Promise<void> => {
    if (!key.trim()) return
    await window.api.gemini.saveKey(key.trim())
    setHasKey(true)
    setKey('')
    setSavedMsg('Key saved.')
    setTimeout(() => setSavedMsg(''), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[30rem] rounded-lg border border-border bg-panel p-5 text-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-accent">Settings</h2>
          <button className="text-gray-400 hover:text-gray-200" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Gemini model */}
        <label className="mb-1 block text-xs uppercase text-gray-500">Gemini model</label>
        <select
          className="mb-4 w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
          value={geminiModel}
          onChange={(e) => onModel(e.target.value)}
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {/* Debate rounds */}
        <label className="mb-1 block text-xs uppercase text-gray-500">
          Debate rounds: {debateRounds}
        </label>
        <input
          type="range"
          min={1}
          max={5}
          value={debateRounds}
          onChange={(e) => onRounds(Number(e.target.value))}
          className="mb-4 w-full accent-accent"
        />

        {/* Terminal shell */}
        <label className="mb-1 block text-xs uppercase text-gray-500">Terminal shell</label>
        <select
          className="mb-4 w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
          value={terminalShell}
          onChange={(e) => onShell(e.target.value as typeof terminalShell)}
        >
          {SHELLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {/* Command trust */}
        <label className="mb-1 block text-xs uppercase text-gray-500">Command trust</label>
        <div className="mb-4 flex items-center justify-between rounded border border-border bg-bg px-2 py-1.5">
          <span className="text-gray-300">{trustedCount} trusted session(s)</span>
          <button
            className="rounded bg-red-600/80 px-2 py-0.5 text-xs text-white disabled:opacity-40"
            disabled={trustedCount === 0}
            onClick={clearTrust}
          >
            Reset all
          </button>
        </div>

        {/* Gemini key */}
        <label className="mb-1 block text-xs uppercase text-gray-500">
          Gemini API key {hasKey && <span className="text-green-400">(set)</span>}
        </label>
        <div className="flex gap-2">
          <input
            type="password"
            className="flex-1 rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
            placeholder={hasKey ? 'Replace key…' : 'AIza…'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveKey()}
          />
          <button
            className="rounded bg-gemini px-3 font-medium text-white disabled:opacity-40"
            disabled={!key.trim()}
            onClick={saveKey}
          >
            Save
          </button>
        </div>
        {savedMsg && <div className="mt-1 text-xs text-green-400">{savedMsg}</div>}

        {/* MCP servers */}
        <div className="mt-4 flex items-center justify-between">
          <label className="block text-xs uppercase text-gray-500">MCP servers</label>
          <button
            className="rounded border border-border px-2 py-0.5 text-xs text-gray-300 hover:bg-bg disabled:opacity-40"
            disabled={mcpBusy}
            onClick={reconnectMcp}
          >
            {mcpBusy ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
        <div className="mt-1 rounded border border-border bg-bg p-2 text-xs">
          {mcp.length === 0 ? (
            <div className="text-gray-500">None configured.</div>
          ) : (
            mcp.map((s) => (
              <div key={s.server} className="flex items-center gap-2 py-0.5">
                <span className={s.connected ? 'text-green-400' : 'text-red-400'}>●</span>
                <span className="text-gray-200">{s.server}</span>
                <span className="text-gray-500">
                  {s.connected ? `${s.toolCount} tools` : s.error || 'failed'}
                </span>
              </div>
            ))
          )}
          <div className="mt-1 truncate text-[10px] text-gray-600" title={mcpPath}>
            Edit: {mcpPath}
          </div>
        </div>
      </div>
    </div>
  )
}
