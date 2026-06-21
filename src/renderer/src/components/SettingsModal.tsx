import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

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

// '' = use the claude CLI's own default; aliases map to latest of each tier.
const CLAUDE_MODELS = [
  { value: '', label: 'CLI default' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' }
]

export default function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const geminiModel = useAppStore((s) => s.geminiModel)
  const claudeModel = useAppStore((s) => s.claudeModel)
  const claudeEffort = useAppStore((s) => s.claudeEffort)
  const debateRounds = useAppStore((s) => s.debateRounds)
  const terminalShell = useAppStore((s) => s.terminalShell)
  const setGeminiModel = useAppStore((s) => s.setGeminiModel)
  const setClaudeModel = useAppStore((s) => s.setClaudeModel)
  const setClaudeEffort = useAppStore((s) => s.setClaudeEffort)
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
  const onClaudeModel = (m: string): void => {
    setClaudeModel(m)
    window.api.settings.set({ claudeModel: m })
  }
  const onClaudeEffort = (e: string): void => {
    setClaudeEffort(e)
    window.api.settings.set({ claudeEffort: e })
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

  const [q, setQ] = useState('')

  // Each setting declares a section + keywords so the search box can filter.
  // A field shows if the query is empty, matches its section, or matches its
  // label/keywords. Sections with no visible fields are hidden.
  const sections: { title: string; fields: { label: string; kw: string; node: JSX.Element }[] }[] = [
    {
      title: 'Models',
      fields: [
        {
          label: 'Gemini model',
          kw: 'gemini api model flash pro',
          node: (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={geminiModel}
              onChange={(e) => onModel(e.target.value)}
            >
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )
        },
        {
          label: 'Claude model (debate)',
          kw: 'claude anthropic model sonnet opus haiku debate',
          node: (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={claudeModel}
              onChange={(e) => onClaudeModel(e.target.value)}
            >
              {CLAUDE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )
        },
        {
          label: 'Claude effort (debate)',
          kw: 'claude effort reasoning low medium high debate',
          node: (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={claudeEffort}
              onChange={(e) => onClaudeEffort(e.target.value)}
            >
              <option value="">default</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          )
        }
      ]
    },
    {
      title: 'Debate',
      fields: [
        {
          label: `Debate rounds: ${debateRounds}`,
          kw: 'debate rounds turns',
          node: (
            <input
              type="range"
              min={1}
              max={5}
              value={debateRounds}
              onChange={(e) => onRounds(Number(e.target.value))}
              className="w-full accent-accent"
            />
          )
        }
      ]
    },
    {
      title: 'Terminal',
      fields: [
        {
          label: 'Terminal shell',
          kw: 'terminal shell powershell pwsh cmd bash zsh',
          node: (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={terminalShell}
              onChange={(e) => onShell(e.target.value as typeof terminalShell)}
            >
              {SHELLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )
        }
      ]
    },
    {
      title: 'Security',
      fields: [
        {
          label: 'Command trust',
          kw: 'security trust approve sessions reset danger',
          node: (
            <div className="flex items-center justify-between rounded border border-border bg-bg px-2 py-1.5">
              <span className="text-gray-300">{trustedCount} trusted session(s)</span>
              <button
                className="rounded bg-red-600/80 px-2 py-0.5 text-xs text-white disabled:opacity-40"
                disabled={trustedCount === 0}
                onClick={clearTrust}
              >
                Reset all
              </button>
            </div>
          )
        }
      ]
    },
    {
      title: 'Keys',
      fields: [
        {
          label: `Gemini API key${hasKey ? ' (set)' : ''}`,
          kw: 'gemini api key credential google',
          node: (
            <>
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
            </>
          )
        }
      ]
    },
    {
      title: 'MCP',
      fields: [
        {
          label: 'MCP servers',
          kw: 'mcp servers tools reconnect model context protocol',
          node: (
            <>
              <div className="mb-1 flex justify-end">
                <button
                  className="rounded border border-border px-2 py-0.5 text-xs text-gray-300 hover:bg-bg disabled:opacity-40"
                  disabled={mcpBusy}
                  onClick={reconnectMcp}
                >
                  {mcpBusy ? 'Reconnecting…' : 'Reconnect'}
                </button>
              </div>
              <div className="rounded border border-border bg-bg p-2 text-xs">
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
            </>
          )
        }
      ]
    }
  ]

  const ql = q.trim().toLowerCase()
  const matches = (title: string, label: string, kw: string): boolean =>
    !ql || title.toLowerCase().includes(ql) || label.toLowerCase().includes(ql) || kw.includes(ql)

  return (
    <div
      style={{ zIndex: Z.dropdown }}
      className="fixed inset-0 flex items-center justify-center bg-black/60"
    >
      <div className="flex max-h-[80vh] w-[32rem] flex-col rounded-lg border border-border bg-panel text-sm">
        <div className="flex items-center justify-between border-b border-border p-4 pb-3">
          <h2 className="text-lg font-semibold text-accent">Settings</h2>
          <button aria-label="Close settings" className="text-gray-400 hover:text-gray-200" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="border-b border-border p-3">
          <input
            autoFocus
            className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
            placeholder="Search settings…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {sections.map((sec) => {
            const visible = sec.fields.filter((f) => matches(sec.title, f.label, f.kw))
            if (visible.length === 0) return null
            return (
              <div key={sec.title}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-accent">{sec.title}</div>
                <div className="space-y-3">
                  {visible.map((f) => (
                    <div key={f.label}>
                      <label className="mb-1 block text-xs uppercase text-gray-500">{f.label}</label>
                      {f.node}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {ql && sections.every((sec) => sec.fields.every((f) => !matches(sec.title, f.label, f.kw))) && (
            <div className="text-gray-500">No settings match “{q}”.</div>
          )}
        </div>
      </div>
    </div>
  )
}
