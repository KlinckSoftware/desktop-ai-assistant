import { useEffect, useState } from 'react'
import type { DebateAgent, Pipeline, PipelineStep, PipelineUpdate } from '@shared/types'
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

  const [participants, setParticipants] = useState<DebateAgent[]>([])
  const [draft, setDraft] = useState<Pipeline>(emptyDraft)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [updates, setUpdates] = useState<PipelineUpdate[]>([])

  useEffect(() => {
    window.api.debate.agents().then(setParticipants)
  }, [])

  useEffect(() => {
    return window.api.pipeline.onUpdate((u) => {
      if (u.type === 'done' || u.type === 'error') setRunning(false)
      if (u.type === 'step' || u.type === 'error') setUpdates((prev) => [...prev, u])
    })
  }, [])

  const firstAgent = participants[0]?.id ?? 'claude'

  const setStep = (i: number, patch: Partial<PipelineStep>): void =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const addStep = (): void => setDraft((d) => ({ ...d, steps: [...d.steps, { agentId: firstAgent }] }))
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

  const run = (): void => {
    if (!input.trim() || draft.steps.length === 0 || running) return
    setUpdates([])
    setRunning(true)
    window.api.pipeline.run(draft.steps, input, dryRun).catch((e) => {
      setUpdates((p) => [...p, { type: 'error', text: String(e) }])
      setRunning(false)
    })
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
      </div>

      <div className="flex flex-col gap-2 overflow-auto border-b border-border p-3">
        <input
          className="rounded border border-border bg-panel px-2 py-1 outline-none focus:border-accent"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Pipeline name"
        />
        {draft.steps.map((step, i) => (
          <div key={i} className="flex items-center gap-1.5">
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
            <select
              className="shrink-0 rounded border border-border bg-panel px-1 py-1 text-[10px] outline-none focus:border-accent"
              value={step.permission ?? 'read-only'}
              onChange={(e) => setStep(i, { permission: e.target.value as PipelineStep['permission'] })}
              title="Tool capability for this step (API steps only)"
            >
              <option value="read-only">read-only</option>
              <option value="edit">edit</option>
              <option value="full">full</option>
            </select>
            <button
              className="shrink-0 px-1 text-gray-500 hover:text-red-400"
              onClick={() => removeStep(i)}
              aria-label={`Remove step ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
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
          placeholder="Input for the pipeline…"
          value={input}
          disabled={running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-gray-400" title="Report intended tool calls without executing">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-accent" />
          dry-run
        </label>
        <button
          className="rounded bg-accent px-3 py-1 font-medium text-black disabled:opacity-40"
          onClick={run}
          disabled={running || draft.steps.length === 0}
        >
          {running ? 'Running…' : dryRun ? 'Dry-run' : 'Run'}
        </button>
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
