import { useEffect, useState } from 'react'
import type { WorktreeInfo, ScheduledJob, JobTrigger } from '@shared/types'
import { CLAUDE_MODELS as CLAUDE_MODELS_FALLBACK, CLAUDE_EFFORT as CLAUDE_EFFORT_FALLBACK } from '@shared/claudeModels'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'
import AgentsModal from './AgentsModal'
import ApiProvidersModal from './ApiProvidersModal'

interface McpStatus {
  server: string
  connected: boolean
  toolCount: number
  error?: string
}

const GEMINI_FALLBACK = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']

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
  const isolateAgents = useAppStore((s) => s.isolateAgents)
  const setIsolateAgents = useAppStore((s) => s.setIsolateAgents)
  const allowSecretReads = useAppStore((s) => s.allowSecretReads)
  const setAllowSecretReads = useAppStore((s) => s.setAllowSecretReads)
  const persistRunOutputs = useAppStore((s) => s.persistRunOutputs)
  const setPersistRunOutputs = useAppStore((s) => s.setPersistRunOutputs)
  const clearHistory = useAppStore((s) => s.clearHistory)
  const allowProtectedWrites = useAppStore((s) => s.allowProtectedWrites)
  const setAllowProtectedWrites = useAppStore((s) => s.setAllowProtectedWrites)
  const pipelineAllowFullDefault = useAppStore((s) => s.pipelineAllowFullDefault)
  const setPipelineAllowFullDefault = useAppStore((s) => s.setPipelineAllowFullDefault)
  const alwaysConfirm = useAppStore((s) => s.alwaysConfirm)
  const setAlwaysConfirm = useAppStore((s) => s.setAlwaysConfirm)
  const autonomousAllow = useAppStore((s) => s.autonomousAllow)
  const setAutonomousAllow = useAppStore((s) => s.setAutonomousAllow)
  const onAutonomousAllow = (v: string): void => {
    setAutonomousAllow(v)
    window.api.settings.set({ autonomousAllow: v })
  }
  const onAllowProtectedWrites = (v: boolean): void => {
    setAllowProtectedWrites(v)
    window.api.settings.set({ allowProtectedWrites: v })
  }
  const onPipelineAllowFullDefault = (v: boolean): void => {
    setPipelineAllowFullDefault(v)
    window.api.settings.set({ pipelineAllowFullDefault: v })
  }
  const trustedCount = useAppStore((s) => s.trustedSessions.size)
  const clearTrust = useAppStore((s) => s.clearTrust)
  const approvalTimeout = useAppStore((s) => s.approvalTimeout)
  const setApprovalTimeout = useAppStore((s) => s.setApprovalTimeout)
  const pipelineDefaultPermission = useAppStore((s) => s.pipelineDefaultPermission)
  const setPipelineDefaultPermission = useAppStore((s) => s.setPipelineDefaultPermission)
  const pipelineDefaultDryRun = useAppStore((s) => s.pipelineDefaultDryRun)
  const setPipelineDefaultDryRun = useAppStore((s) => s.setPipelineDefaultDryRun)
  const startupAgent = useAppStore((s) => s.startupAgent)
  const setStartupAgent = useAppStore((s) => s.setStartupAgent)
  const agents = useAppStore((s) => s.agents)
  const apiProviders = useAppStore((s) => s.apiProviders)
  const setApiProviders = useAppStore((s) => s.setApiProviders)
  const terminalFontSize = useAppStore((s) => s.terminalFontSize)
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize)
  const terminalScrollback = useAppStore((s) => s.terminalScrollback)
  const setTerminalScrollback = useAppStore((s) => s.setTerminalScrollback)
  const editorFontSize = useAppStore((s) => s.editorFontSize)
  const setEditorFontSize = useAppStore((s) => s.setEditorFontSize)
  const editorWrap = useAppStore((s) => s.editorWrap)
  const setEditorWrap = useAppStore((s) => s.setEditorWrap)
  const costCap = useAppStore((s) => s.costCap)
  const setCostCap = useAppStore((s) => s.setCostCap)
  const accentColor = useAppStore((s) => s.accentColor)
  const setAccentColor = useAppStore((s) => s.setAccentColor)
  const ACCENTS = ['#58a6ff', '#a371f7', '#3fb950', '#f778ba', '#ff7b72', '#d29922', '#39c5cf']
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})

  const saveProviderKey = async (id: string): Promise<void> => {
    const v = (keyInputs[id] ?? '').trim()
    if (!v) return
    await window.api.api.saveKey(id, v)
    setApiProviders(await window.api.api.providers())
    setKeyInputs((m) => ({ ...m, [id]: '' }))
  }

  const [showAgents, setShowAgents] = useState(false)
  const [showProviders, setShowProviders] = useState(false)
  const [mcpName, setMcpName] = useState('')
  const [mcpCmd, setMcpCmd] = useState('')
  const addMcp = async (): Promise<void> => {
    if (!mcpName.trim() || !mcpCmd.trim()) return
    const [command, ...args] = mcpCmd.trim().split(/\s+/)
    setMcpBusy(true)
    setMcp(await window.api.mcp.addServer(mcpName.trim(), { command, args }))
    setMcpBusy(false)
    setMcpName('')
    setMcpCmd('')
  }
  const hasKey = useAppStore((s) => s.hasGeminiKey)
  const setHasKey = useAppStore((s) => s.setHasGeminiKey)

  const [key, setKey] = useState('')
  const [savedMsg, setSavedMsg] = useState('')
  const [mcp, setMcp] = useState<McpStatus[]>([])
  const [mcpPath, setMcpPath] = useState('')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [geminiModels, setGeminiModels] = useState<string[]>(GEMINI_FALLBACK)
  const [claudeModels, setClaudeModels] = useState(CLAUDE_MODELS_FALLBACK)
  const [claudeEfforts, setClaudeEfforts] = useState(CLAUDE_EFFORT_FALLBACK)

  useEffect(() => {
    window.api.mcp.status().then(setMcp)
    window.api.mcp.configPath().then(setMcpPath)
    window.api.gemini.listModels().then(setGeminiModels).catch(() => {})
    window.api.claude
      .listModels()
      .then((r) => {
        setClaudeModels(r.models)
        setClaudeEfforts(r.effort)
      })
      .catch(() => {})
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
  const onIsolate = (v: boolean): void => {
    setIsolateAgents(v)
    window.api.settings.set({ isolateAgents: v })
  }
  const onAllowSecretReads = (v: boolean): void => {
    setAllowSecretReads(v)
    window.api.settings.set({ allowSecretReads: v })
  }
  const closeToTray = useAppStore((s) => s.closeToTray)
  const setCloseToTray = useAppStore((s) => s.setCloseToTray)
  const imageProvider = useAppStore((s) => s.imageProvider)
  const setImageProvider = useAppStore((s) => s.setImageProvider)
  const onImageProvider = (v: 'pollinations' | 'imagen'): void => {
    setImageProvider(v)
    window.api.settings.set({ imageProvider: v })
  }
  const onCloseToTray = (v: boolean): void => {
    setCloseToTray(v)
    window.api.settings.set({ closeToTray: v })
  }
  const clearAllHistory = async (): Promise<void> => {
    if (!window.confirm('Clear all chat, debate, and run history? This cannot be undone.')) return
    clearHistory()
    await window.api.pipeline.clearRuns()
    await window.api.gemini.clearGeneratedImages()
    setSavedMsg('History cleared.')
    setTimeout(() => setSavedMsg(''), 2000)
  }
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const loadWorktrees = (): void => {
    window.api.worktree.list().then(setWorktrees)
  }
  useEffect(() => {
    loadWorktrees()
    return window.api.worktree.onChanged(loadWorktrees)
  }, [])
  const removeWorktree = async (sessionId: string, mode: 'merge' | 'discard'): Promise<void> => {
    if (mode === 'discard' && !window.confirm('Discard this branch and all its work? This cannot be undone.')) return
    const status = await window.api.worktree.remove(sessionId, mode)
    if (status && status.startsWith('[merge failed]')) {
      setSavedMsg(status)
      setTimeout(() => setSavedMsg(''), 6000)
    }
    loadWorktrees()
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

  // --- Scheduled jobs ---
  const pipelines = useAppStore((s) => s.pipelines)
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [jobName, setJobName] = useState('')
  const [jobPipelineId, setJobPipelineId] = useState('')
  const [jobInput, setJobInput] = useState('')
  const [jobTrigger, setJobTrigger] = useState<'interval' | 'daily' | 'git'>('interval')
  const [jobInterval, setJobInterval] = useState(60)
  const [jobTime, setJobTime] = useState('09:00')
  const [jobAllowFull, setJobAllowFull] = useState(pipelineAllowFullDefault)
  // Risk of the selected pipeline when run unattended.
  const jobPipeline = pipelines.find((x) => x.id === jobPipelineId)
  const jobHasFull = (jobPipeline?.steps ?? []).some((s) => s.permission === 'full')
  const jobHasWrite = (jobPipeline?.steps ?? []).some((s) => s.permission === 'edit' || s.permission === 'full')
  const loadJobs = (): void => {
    window.api.jobs.list().then(setJobs)
  }
  useEffect(() => {
    loadJobs()
    return window.api.jobs.onChanged(loadJobs)
  }, [])
  const triggerLabel = (t: JobTrigger): string =>
    t.kind === 'interval' ? `every ${t.minutes}m` : t.kind === 'daily' ? `daily ${t.time}` : 'on git change'
  const addJob = async (): Promise<void> => {
    const p = pipelines.find((x) => x.id === jobPipelineId)
    if (!jobName.trim() || !p || p.steps.length === 0) return
    const trigger: JobTrigger =
      jobTrigger === 'interval'
        ? { kind: 'interval', minutes: Math.max(1, jobInterval) }
        : jobTrigger === 'daily'
          ? { kind: 'daily', time: jobTime }
          : { kind: 'git' }
    const job: ScheduledJob = {
      id: globalThis.crypto?.randomUUID?.() ?? `job_${Date.now()}`,
      name: jobName.trim(),
      steps: JSON.parse(JSON.stringify(p.steps)),
      input: jobInput,
      trigger,
      enabled: true,
      allowFull: jobHasFull ? jobAllowFull : undefined
    }
    setJobs(await window.api.jobs.save(job))
    setJobName('')
    setJobInput('')
    setJobAllowFull(false)
  }
  const toggleJob = async (job: ScheduledJob): Promise<void> => {
    setJobs(await window.api.jobs.save({ ...job, enabled: !job.enabled }))
  }
  const removeJob = async (id: string): Promise<void> => {
    setJobs(await window.api.jobs.remove(id))
  }

  // Debate is pairwise (A proposes / B critiques); these are the default sides.
  const debateSideA = useAppStore((s) => s.debateSideA)
  const debateSideB = useAppStore((s) => s.debateSideB)
  const setDebateSides = useAppStore((s) => s.setDebateSides)
  const [debateParticipants, setDebateParticipants] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    window.api.debate.agents().then(setDebateParticipants)
  }, [])

  const [q, setQ] = useState('')
  const [activeSection, setActiveSection] = useState('Models')

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
              {geminiModels.map((m) => (
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
              {claudeModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )
        },
        {
          label: 'Claude effort (debate)',
          kw: 'claude effort reasoning low medium high xhigh max debate',
          node: (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={claudeEffort}
              onChange={(e) => onClaudeEffort(e.target.value)}
            >
              {claudeEfforts.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          )
        },
        {
          label: 'Image generation provider',
          kw: 'image generation imagen pollinations free provider picture',
          node: (
            <div>
              <select
                className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
                value={imageProvider}
                onChange={(e) => onImageProvider(e.target.value as 'pollinations' | 'imagen')}
              >
                <option value="pollinations">Pollinations — free, no key (testing)</option>
                <option value="imagen">Google Imagen — paid, uses Gemini key</option>
              </select>
              <div className="mt-1 text-[11px] text-gray-500">
                Backend for the 🖼 button in the Gemini panel. Pollinations is keyless and
                rate-limited (fine for testing); Imagen bills your Google account per image.
              </div>
            </div>
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
        },
        {
          label: 'Default seats 1 & 2',
          kw: 'debate participants sides default models a b vs pairwise seats',
          node: (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <select
                  className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
                  value={debateSideA}
                  onChange={(e) => setDebateSides(e.target.value, debateSideB)}
                >
                  {debateParticipants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span className="shrink-0 text-gray-500">vs</span>
                <select
                  className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
                  value={debateSideB}
                  onChange={(e) => setDebateSides(debateSideA, e.target.value)}
                >
                  {debateParticipants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-gray-500">
                Debates seat 2-4 participants: round 1 everyone proposes, later rounds each critiques the
                others in turn, then the chosen synthesizer writes up the final result (gated by your
                approval). These two seed the first two seats each time you open the Debate panel — add up
                to two more, and change synthesizer, per-run there.
              </p>
              {debateParticipants.length < 2 && (
                <p className="text-[10px] text-yellow-400">Need ≥2 usable models — add an API key or install a CLI.</p>
              )}
            </div>
          )
        }
      ]
    },
    {
      title: 'Isolation',
      fields: [
        {
          label: 'Run each CLI agent in its own git worktree/branch',
          kw: 'isolation worktree branch agent sandbox parallel git',
          node: (
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={isolateAgents} onChange={(e) => onIsolate(e.target.checked)} />
                <span className="text-gray-300">
                  Isolate agents (needs a git repo with at least one commit; falls back to the shared
                  folder otherwise)
                </span>
              </label>
            </div>
          )
        },
        {
          label: 'Active worktrees',
          kw: 'worktree branch merge discard review isolation active',
          node: (
            <div className="space-y-2">
              {worktrees.length === 0 ? (
                <p className="text-xs text-gray-500">No isolated worktrees. Start a CLI agent to create one.</p>
              ) : (
                worktrees.map((w) => (
                  <div
                    key={w.sessionId}
                    className="flex items-center gap-2 rounded border border-border bg-bg px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-gray-200">{w.label || w.kind}</div>
                      <div className="truncate font-mono text-[11px] text-gray-500">
                        {w.branch} → {w.base}
                      </div>
                    </div>
                    <button
                      className="shrink-0 rounded border border-green-700/60 px-2 py-0.5 text-xs text-green-300 hover:bg-green-900/30"
                      onClick={() => removeWorktree(w.sessionId, 'merge')}
                      title="Squash-merge this branch into its base, then remove the worktree"
                    >
                      Merge
                    </button>
                    <button
                      className="shrink-0 rounded border border-red-700/60 px-2 py-0.5 text-xs text-red-300 hover:bg-red-900/30"
                      onClick={() => removeWorktree(w.sessionId, 'discard')}
                      title="Delete the branch and its work, remove the worktree"
                    >
                      Discard
                    </button>
                  </div>
                ))
              )}
            </div>
          )
        }
      ]
    },
    {
      title: 'Schedules',
      fields: [
        {
          label: 'Scheduled pipeline jobs (run while the app is open)',
          kw: 'schedule scheduled job cron interval daily git automate background pipeline',
          node: (
            <div className="space-y-3">
              {jobs.length > 0 && (
                <div className="space-y-1">
                  {jobs.map((j) => (
                    <div
                      key={j.id}
                      className="flex items-center gap-2 rounded border border-border bg-bg px-2 py-1.5"
                    >
                      <input type="checkbox" checked={j.enabled} onChange={() => toggleJob(j)} title="Enable/disable" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-gray-200">{j.name}</div>
                        <div className="truncate text-[10px] text-gray-500">
                          {triggerLabel(j.trigger)}
                          {j.lastRun ? ` · last ${new Date(j.lastRun).toLocaleString()}` : ' · never run'}
                        </div>
                      </div>
                      <button
                        className="shrink-0 rounded border border-border px-2 py-0.5 text-gray-300 hover:bg-panel"
                        onClick={() => window.api.jobs.runNow(j.id)}
                        title="Run this job now"
                      >
                        Run
                      </button>
                      <button
                        className="shrink-0 rounded border border-red-700/60 px-2 py-0.5 text-red-300 hover:bg-red-900/30"
                        onClick={() => removeJob(j.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* add-job form */}
              <div className="space-y-1.5 rounded border border-border/60 p-2">
                <input
                  className="w-full rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
                  placeholder="Job name"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                />
                <select
                  className="w-full rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
                  value={jobPipelineId}
                  onChange={(e) => setJobPipelineId(e.target.value)}
                >
                  <option value="">Pick a saved pipeline…</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  className="w-full rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
                  placeholder="Starting input (optional)"
                  value={jobInput}
                  onChange={(e) => setJobInput(e.target.value)}
                />
                <div className="flex items-center gap-1.5">
                  <select
                    className="rounded border border-border bg-bg px-1.5 py-1 outline-none focus:border-accent"
                    value={jobTrigger}
                    onChange={(e) => setJobTrigger(e.target.value as 'interval' | 'daily' | 'git')}
                  >
                    <option value="interval">every N min</option>
                    <option value="daily">daily at</option>
                    <option value="git">on git change</option>
                  </select>
                  {jobTrigger === 'interval' && (
                    <input
                      type="number"
                      min={1}
                      className="w-20 rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
                      value={jobInterval}
                      onChange={(e) => setJobInterval(Math.max(1, Number(e.target.value) || 60))}
                    />
                  )}
                  {jobTrigger === 'daily' && (
                    <input
                      type="time"
                      className="rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
                      value={jobTime}
                      onChange={(e) => setJobTime(e.target.value)}
                    />
                  )}
                  <button
                    className="ml-auto rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
                    onClick={addJob}
                    disabled={!jobName.trim() || !jobPipelineId || (jobHasFull && !jobAllowFull)}
                  >
                    Add job
                  </button>
                </div>
                {jobHasWrite && (
                  <div className="rounded border border-yellow-700/50 bg-yellow-900/10 p-1.5 text-[10px] text-yellow-300">
                    ⚠ This pipeline {jobHasFull ? 'runs shell commands and ' : ''}edits files — unattended, with no
                    approval prompt.
                    {jobTrigger === 'git' && ' On a git trigger its own edits can keep retriggering it.'}
                    {jobHasFull && (
                      <label className="mt-1 flex items-center gap-1 text-yellow-200">
                        <input type="checkbox" checked={jobAllowFull} onChange={(e) => setJobAllowFull(e.target.checked)} />
                        I understand — allow autonomous shell (full)
                      </label>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-gray-500">
                  Jobs run unattended through the pipeline&apos;s per-step permissions (autonomous) and only while
                  this app is open or minimized to tray. Output appears in the Review panel and run history.
                </p>
              </div>
            </div>
          )
        },
        {
          label: 'Close to tray',
          kw: 'tray close minimize background quit scheduler close-to-tray minimized',
          node: (
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={closeToTray} onChange={(e) => onCloseToTray(e.target.checked)} />
                <span className="text-gray-300">
                  Keep running in the background when the window is closed — scheduled jobs continue. Quit from
                  the tray icon.
                </span>
              </label>
            </div>
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
        },
        {
          label: 'Terminal font size (applies to new terminals)',
          kw: 'terminal font size text',
          node: (
            <input
              type="number"
              min={8}
              max={32}
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={terminalFontSize}
              onChange={(e) => setTerminalFontSize(Math.max(8, Math.min(32, Number(e.target.value) || 13)))}
            />
          )
        },
        {
          label: 'Terminal scrollback (lines)',
          kw: 'terminal scrollback history lines buffer',
          node: (
            <input
              type="number"
              min={500}
              max={100000}
              step={500}
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={terminalScrollback}
              onChange={(e) => setTerminalScrollback(Math.max(500, Number(e.target.value) || 10000))}
            />
          )
        }
      ]
    },
    {
      title: 'Editor',
      fields: [
        {
          label: 'Editor font size',
          kw: 'editor font size code text',
          node: (
            <input
              type="number"
              min={8}
              max={32}
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={editorFontSize}
              onChange={(e) => setEditorFontSize(Math.max(8, Math.min(32, Number(e.target.value) || 13)))}
            />
          )
        },
        {
          label: 'Word wrap',
          kw: 'editor word wrap lines',
          node: (
            <label className="flex items-center gap-2 text-gray-300">
              <input
                type="checkbox"
                className="accent-accent"
                checked={editorWrap}
                onChange={(e) => setEditorWrap(e.target.checked)}
              />
              Wrap long lines
            </label>
          )
        }
      ]
    },
    {
      title: 'Appearance',
      fields: [
        {
          label: 'Accent color',
          kw: 'appearance theme accent color',
          node: (
            <div className="flex items-center gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  className={`h-6 w-6 rounded-full border-2 ${accentColor === c ? 'border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setAccentColor(c)}
                  aria-label={`Accent ${c}`}
                />
              ))}
              <input
                type="color"
                className="h-6 w-8 cursor-pointer rounded border border-border bg-bg"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                title="Custom accent"
              />
            </div>
          )
        }
      ]
    },
    {
      title: 'Budget',
      fields: [
        {
          label: 'Session cost cap (USD, 0 = off)',
          kw: 'budget cost cap money usd limit spend token',
          node: (
            <input
              type="number"
              min={0}
              step={0.5}
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={costCap}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0)
                setCostCap(v)
                window.api.settings.set({ costCap: v }) // main enforces the cap too
              }}
            />
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
        },
        {
          label: 'Approval auto-reject timeout (seconds, 0 = never)',
          kw: 'security approval timeout auto reject seconds card',
          node: (
            <input
              type="number"
              min={0}
              max={600}
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={approvalTimeout}
              onChange={(e) => setApprovalTimeout(Math.max(0, Math.min(600, Number(e.target.value) || 0)))}
            />
          )
        },
        {
          label: 'Allow tools to read secret files',
          kw: 'security secret env key credentials read privacy ssh pem',
          node: (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allowSecretReads} onChange={(e) => onAllowSecretReads(e.target.checked)} />
              <span className="text-gray-300">
                Let agents read secret-looking files (.env, keys, .ssh) and send them to the model. Off by default —
                the editor still opens them on your click.
              </span>
            </label>
          )
        },
        {
          label: 'Privacy & data',
          kw: 'privacy data clear history persist outputs egress provider local',
          node: (
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={persistRunOutputs}
                  onChange={(e) => setPersistRunOutputs(e.target.checked)}
                />
                <span className="text-gray-300">Persist run output text in history (off = keep metadata only)</span>
              </label>
              <button
                className="rounded bg-red-600/80 px-2 py-1 text-xs text-white"
                onClick={clearAllHistory}
              >
                Clear chat &amp; run history
              </button>
              <p className="text-[10px] text-gray-500">
                History (chats, debate, run outputs) and jobs are stored unencrypted on this machine. Files you read or
                @-mention are sent to the selected provider; multi-provider pipelines spread that content across vendors.
                Images generated in the Gemini panel are saved under your user data folder and deleted by this action too.
              </p>
            </div>
          )
        },
        {
          label: 'Always require approval (no trusted auto-approve)',
          kw: 'security restrict approval always confirm trust auto-approve',
          node: (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={alwaysConfirm} onChange={(e) => setAlwaysConfirm(e.target.checked)} />
              <span className="text-gray-300">
                Show an approval card for every command/tool, even in a trusted session (restrict).
              </span>
            </label>
          )
        },
        {
          label: 'Default "allow shell (full)" on new pipeline runs',
          kw: 'security pipeline full shell autonomous default loosen allow',
          node: (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={pipelineAllowFullDefault}
                onChange={(e) => onPipelineAllowFullDefault(e.target.checked)}
              />
              <span className="text-gray-300">
                Pre-tick the per-run shell opt-in for `full` steps (loosen). Off = opt in each run.
              </span>
            </label>
          )
        },
        {
          label: 'Autonomous command allowlist (restrict)',
          kw: 'security autonomous command allowlist restrict shell pipeline heads',
          node: (
            <div className="space-y-1">
              <input
                className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
                placeholder="e.g. npm, pytest, git, ls  (blank = no extra restriction)"
                value={autonomousAllow}
                onChange={(e) => onAutonomousAllow(e.target.value)}
              />
              <p className="text-[10px] text-gray-500">
                When set, an autonomous (pipeline/scheduled) shell command only runs if its first word is in this
                list — on top of the always-on dangerous-command block. Blank = allow any non-dangerous command.
              </p>
            </div>
          )
        },
        {
          label: 'Allow writes to .git/ and node_modules/',
          kw: 'security protected git node_modules write loosen advanced danger',
          node: (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowProtectedWrites}
                onChange={(e) => onAllowProtectedWrites(e.target.checked)}
              />
              <span className="text-yellow-300">
                ⚠ Advanced/loosen: lets agents write into .git/ and node_modules/. Re-opens the git-hook execution risk.
                Leave off unless you know why.
              </span>
            </label>
          )
        }
      ]
    },
    {
      title: 'Pipelines',
      fields: [
        {
          label: 'Default step permission',
          kw: 'pipeline default permission read edit full tools',
          node: (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={pipelineDefaultPermission}
              onChange={(e) => setPipelineDefaultPermission(e.target.value as typeof pipelineDefaultPermission)}
            >
              <option value="read-only">read-only</option>
              <option value="edit">edit</option>
              <option value="full">full</option>
            </select>
          )
        },
        {
          label: 'Default to dry-run',
          kw: 'pipeline default dry run safe',
          node: (
            <label className="flex items-center gap-2 text-gray-300">
              <input
                type="checkbox"
                className="accent-accent"
                checked={pipelineDefaultDryRun}
                onChange={(e) => setPipelineDefaultDryRun(e.target.checked)}
              />
              New runs start in dry-run
            </label>
          )
        }
      ]
    },
    {
      title: 'Startup',
      fields: [
        {
          label: 'Default agent on launch',
          kw: 'startup default agent launch claude cli',
          node: (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 outline-none focus:border-accent"
              value={startupAgent}
              onChange={(e) => setStartupAgent(e.target.value)}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={a.available === false}>
                  {a.name}
                  {a.available === false ? ' (not installed)' : ''}
                </option>
              ))}
            </select>
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
        },
        {
          label: 'Provider API keys',
          kw: 'api key openai groq mistral openrouter google provider credential',
          node: (
            <div className="space-y-2">
              {apiProviders
                .filter((p) => !p.noKey)
                .map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-gray-300" title={p.name}>
                      {p.name} {p.hasKey && <span className="text-green-400">●</span>}
                    </span>
                    <input
                      type="password"
                      className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
                      placeholder={p.hasKey ? 'Replace key…' : 'Set key…'}
                      value={keyInputs[p.id] ?? ''}
                      onChange={(e) => setKeyInputs((m) => ({ ...m, [p.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && saveProviderKey(p.id)}
                    />
                    <button
                      className="shrink-0 rounded bg-gemini px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
                      disabled={!(keyInputs[p.id] ?? '').trim()}
                      onClick={() => saveProviderKey(p.id)}
                    >
                      Save
                    </button>
                  </div>
                ))}
            </div>
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
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  className="w-24 rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                  placeholder="name"
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                />
                <input
                  className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                  placeholder="command + args (e.g. npx -y @scope/server)"
                  value={mcpCmd}
                  onChange={(e) => setMcpCmd(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addMcp()}
                />
                <button
                  className="shrink-0 rounded bg-accent px-2 py-1 text-xs font-medium text-black disabled:opacity-40"
                  disabled={mcpBusy || !mcpName.trim() || !mcpCmd.trim()}
                  onClick={addMcp}
                >
                  Add
                </button>
              </div>
            </>
          )
        }
      ]
    },
    {
      title: 'Manage',
      fields: [
        {
          label: 'Agents & providers',
          kw: 'manage agents providers add cli model registry',
          node: (
            <div className="flex gap-2">
              <button
                className="flex-1 rounded border border-border bg-bg px-2 py-1.5 text-gray-200 hover:border-accent"
                onClick={() => setShowAgents(true)}
              >
                Manage agents…
              </button>
              <button
                className="flex-1 rounded border border-border bg-bg px-2 py-1.5 text-gray-200 hover:border-accent"
                onClick={() => setShowProviders(true)}
              >
                Manage providers…
              </button>
            </div>
          )
        }
      ]
    }
  ]

  const ql = q.trim().toLowerCase()
  const matches = (title: string, label: string, kw: string): boolean =>
    !ql || title.toLowerCase().includes(ql) || label.toLowerCase().includes(ql) || kw.includes(ql)

  // Sections shown in the left nav: all, or (when searching) only those with a
  // matching field. The visible/active section is the selected one if it still
  // matches, else the first matching section.
  const navSections = ql ? sections.filter((sec) => sec.fields.some((f) => matches(sec.title, f.label, f.kw))) : sections
  const current = navSections.find((s) => s.title === activeSection) ?? navSections[0]
  const visibleFields = current ? current.fields.filter((f) => matches(current.title, f.label, f.kw)) : []

  return (
    <div style={{ zIndex: Z.dropdown }} className="fixed inset-0 flex items-center justify-center bg-black/60 p-6">
      <div className="flex h-[82vh] max-h-[82vh] w-[56rem] max-w-full flex-col rounded-lg border border-border bg-panel text-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold text-accent">Settings</h2>
          <button aria-label="Close settings" className="text-gray-400 hover:text-gray-200" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* left: search + section nav */}
          <div className="flex w-48 shrink-0 flex-col border-r border-border">
            <div className="p-2">
              <input
                autoFocus
                className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-accent"
                placeholder="Search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {navSections.map((sec) => (
                <button
                  key={sec.title}
                  onClick={() => setActiveSection(sec.title)}
                  className={`block w-full px-3 py-1.5 text-left text-xs ${
                    current?.title === sec.title ? 'bg-bg font-medium text-accent' : 'text-gray-300 hover:bg-bg/50'
                  }`}
                >
                  {sec.title}
                </button>
              ))}
              {ql && navSections.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-500">No matches.</div>
              )}
            </div>
          </div>

          {/* right: active section's fields */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {current ? (
              <>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-accent">{current.title}</div>
                <div className="space-y-4">
                  {visibleFields.map((f) => (
                    <div key={f.label}>
                      <label className="mb-1 block text-xs uppercase text-gray-500">{f.label}</label>
                      {f.node}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-gray-500">No settings match “{q}”.</div>
            )}
          </div>
        </div>
      </div>
      {showAgents && <AgentsModal onClose={() => setShowAgents(false)} />}
      {showProviders && <ApiProvidersModal onClose={() => setShowProviders(false)} />}
    </div>
  )
}
