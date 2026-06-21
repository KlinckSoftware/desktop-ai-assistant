import { useEffect, useRef, useState } from 'react'
import type { DebateAgent, Pipeline, PipelineStep, PipelineUpdate, PipelineRun } from '@shared/types'
import { useAppStore } from '../store/appStore'

const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}`)

const emptyDraft = (): Pipeline => ({ id: newId(), name: 'New pipeline', steps: [] })

// Saved agent pipelines: chain participants so each one's output feeds the next.
// Edit + save chains; run a prompt through them and watch each step's output.
export default function PipelinePanel(): JSX.Element {
  const pipelines = useAppStore((s) => s.pipelines)
  const savePipeline = useAppStore((s) => s.savePipeline)
  const removePipeline = useAppStore((s) => s.removePipeline)
  const apiProviders = useAppStore((s) => s.apiProviders)
  const defaultPermission = useAppStore((s) => s.pipelineDefaultPermission)
  const defaultDryRun = useAppStore((s) => s.pipelineDefaultDryRun)
  const pipelineRuns = useAppStore((s) => s.pipelineRuns)
  const addPipelineRun = useAppStore((s) => s.addPipelineRun)

  const [participants, setParticipants] = useState<DebateAgent[]>([])
  const [draft, setDraft] = useState<Pipeline>(emptyDraft)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [dryRun, setDryRun] = useState(defaultDryRun)
  const [updates, setUpdates] = useState<PipelineUpdate[]>([])
  // Accumulates the in-flight run so it can be saved to history on completion.
  const runRef = useRef<{ input: string; dryRun: boolean; steps: PipelineStep[]; updates: PipelineUpdate[] } | null>(null)

  useEffect(() => {
    window.api.debate.agents().then(setParticipants)
  }, [])

  useEffect(() => {
    return window.api.pipeline.onUpdate((u) => {
      if (u.type === 'step' || u.type === 'error') {
        setUpdates((prev) => [...prev, u])
        runRef.current?.updates.push(u)
      }
      if (u.type === 'done' || u.type === 'error') {
        setRunning(false)
        const r = runRef.current
        if (r) {
          addPipelineRun({ id: newId(), ts: Date.now(), input: r.input, dryRun: r.dryRun, steps: r.steps, updates: r.updates })
          runRef.current = null
        }
      }
    })
  }, [addPipelineRun])

  const firstAgent = participants[0]?.id ?? 'claude'

  const setStep = (i: number, patch: Partial<PipelineStep>): void =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const addStep = (): void =>
    setDraft((d) => ({ ...d, steps: [...d.steps, { agentId: firstAgent, permission: defaultPermission }] }))
  const removeStep = (i: number): void => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))

  const loadPipeline = (id: string): void => {
    if (id === '') return setDraft(emptyDraft())
    const p = pipelines.find((x) => x.id === id)
    if (p) setDraft(JSON.parse(JSON.stringify(p)))
  }

  const save = (): void => {
    if (!draft.name.trim() || draft.steps.length === 0) return
    savePipeline(draft)
  }
  const del = (): void => {
    removePipeline(draft.id)
    setDraft(emptyDraft())
  }

  // Can run if there are steps and there's *something* to feed step 1 — either
  // the Input box or step 1's own instruction.
  const hasStarter = input.trim().length > 0 || (draft.steps[0]?.instruction ?? '').trim().length > 0
  const canRun = !running && draft.steps.length > 0 && hasStarter

  const run = (): void => {
    if (!canRun) return
    setUpdates([])
    runRef.current = { input, dryRun, steps: draft.steps, updates: [] }
    setRunning(true)
    window.api.pipeline.run(draft.steps, input, dryRun).catch((e) => {
      setUpdates((p) => [...p, { type: 'error', text: String(e) }])
      setRunning(false)
      runRef.current = null
    })
  }

  // Reopen a past run: load its input/steps/output back into the panel.
  const loadRun = (id: string): void => {
    const r = pipelineRuns.find((x) => x.id === id)
    if (!r) return
    setUpdates(r.updates)
    setInput(r.input)
    setDryRun(r.dryRun)
    setDraft((d) => ({ ...d, steps: JSON.parse(JSON.stringify(r.steps)) }))
  }
  const runLabel = (r: PipelineRun): string => {
    const txt = (r.input || r.steps[0]?.instruction || '(run)').replace(/\s+/g, ' ').slice(0, 28)
    return `${txt}${r.dryRun ? ' [dry]' : ''}`
  }

  const nameFor = (agentId: string): string => participants.find((p) => p.id === agentId)?.name ?? agentId
  const tooFewModels = participants.length === 0

  return (
    <div className="flex h-full flex-col bg-bg text-xs">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="font-semibold text-accent">Pipelines</span>
        <select
          className="rounded border border-border bg-panel px-1.5 py-0.5 outline-none focus:border-accent"
          value={pipelines.some((p) => p.id === draft.id) ? draft.id : ''}
          onChange={(e) => loadPipeline(e.target.value)}
        >
          <option value="">+ New</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {pipelineRuns.length > 0 && (
          <select
            className="ml-auto max-w-[10rem] rounded border border-border bg-panel px-1.5 py-0.5 text-[11px] text-gray-300 outline-none focus:border-accent"
            value=""
            onChange={(e) => e.target.value && loadRun(e.target.value)}
            title="Reopen a past run"
          >
            <option value="">History ▾</option>
            {pipelineRuns.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-2 overflow-auto border-b border-border p-3">
        <label className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-gray-500">Name</span>
          <input
            className="flex-1 rounded border border-border bg-panel px-2 py-1 outline-none focus:border-accent"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Pipeline name (for saving)"
          />
        </label>
        {draft.steps.map((step, i) => {
          const part = participants.find((p) => p.id === step.agentId)
          const isClaude = part?.kind === 'claude'
          const provider = part?.kind === 'api' ? apiProviders.find((p) => p.id === step.agentId.slice(4)) : undefined
          const modelHints = isClaude ? ['sonnet', 'opus', 'haiku'] : (provider?.models ?? [])
          return (
            <div key={i} className="rounded border border-border/60 p-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-4 shrink-0 text-gray-600">{i + 1}.</span>
                <select
                  className="shrink-0 rounded border border-border bg-panel px-1.5 py-1 outline-none focus:border-accent"
                  value={step.agentId}
                  onChange={(e) => setStep(i, { agentId: e.target.value })}
                >
                  {participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1 outline-none focus:border-accent"
                  value={step.instruction ?? ''}
                  onChange={(e) => setStep(i, { instruction: e.target.value })}
                  placeholder="optional instruction (e.g. 'review this')"
                />
                <button
                  className="shrink-0 px-1 text-gray-500 hover:text-red-400"
                  onClick={() => removeStep(i)}
                  aria-label={`Remove step ${i + 1}`}
                >
                  ✕
                </button>
              </div>
              <div className="mt-1 flex items-center gap-1.5 pl-6 text-[10px]">
                <select
                  className="rounded border border-border bg-panel px-1 py-0.5 outline-none focus:border-accent"
                  value={step.permission ?? 'read-only'}
                  onChange={(e) => setStep(i, { permission: e.target.value as PipelineStep['permission'] })}
                  title="Tool capability for this step"
                >
                  <option value="read-only">read-only</option>
                  <option value="edit">edit</option>
                  <option value="full">full</option>
                </select>
                <input
                  className="w-32 rounded border border-border bg-panel px-1.5 py-0.5 outline-none focus:border-accent"
                  value={step.model ?? ''}
                  onChange={(e) => setStep(i, { model: e.target.value })}
                  list={`pmodels-${i}`}
                  placeholder={provider?.defaultModel ?? 'default model'}
                  title="Model override (blank = participant default)"
                />
                <datalist id={`pmodels-${i}`}>
                  {modelHints.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {isClaude && (
                  <select
                    className="rounded border border-border bg-panel px-1 py-0.5 outline-none focus:border-accent"
                    value={step.effort ?? ''}
                    onChange={(e) => setStep(i, { effort: e.target.value })}
                    title="Reasoning effort (Claude)"
                  >
                    <option value="">effort: default</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                )}
              </div>
            </div>
          )
        })}
        <div className="flex items-center gap-2">
          <button
            className="rounded border border-border px-2 py-1 text-gray-300 hover:bg-panel disabled:opacity-40"
            onClick={addStep}
            disabled={tooFewModels}
          >
            + Step
          </button>
          <button
            className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
            onClick={save}
            disabled={!draft.name.trim() || draft.steps.length === 0}
          >
            Save
          </button>
          {pipelines.some((p) => p.id === draft.id) && (
            <button className="rounded border border-border px-2 py-1 text-gray-400 hover:bg-panel" onClick={del}>
              Delete
            </button>
          )}
        </div>
        {tooFewModels && <div className="text-[11px] text-yellow-400">No usable models — add an API key or CLI.</div>}
      </div>

      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <input
          className="flex-1 rounded border border-border bg-panel px-2 py-1 outline-none focus:border-accent disabled:opacity-50"
          placeholder="Starting input… (optional if step 1 has an instruction)"
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-gray-400" title="Report intended tool calls without executing">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-accent" />
          dry-run
        </label>
        {running ? (
          <button
            className="rounded bg-red-600 px-3 py-1 font-medium text-white"
            onClick={() => {
              window.api.pipeline.cancel()
              setRunning(false)
            }}
          >
            Stop
          </button>
        ) : (
          <button
            className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
            onClick={run}
            disabled={!canRun}
          >
            {dryRun ? 'Dry-run' : 'Run'}
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {updates.length === 0 && !running && (
          <div className="text-gray-500">
            Build a chain of agents, save it, then run a prompt through. Each step&apos;s output feeds the next.
          </div>
        )}
        {updates.map((u, i) => (
          <div key={i} className="rounded-lg border border-border bg-panel p-3">
            <div className={`mb-1 text-xs font-semibold uppercase ${u.type === 'error' ? 'text-red-400' : 'text-accent'}`}>
              {u.type === 'error' ? 'error' : `${(u.index ?? 0) + 1}. ${u.name ?? nameFor(u.agentId ?? '')}`}
            </div>
            <div className="whitespace-pre-wrap text-gray-200">{u.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
