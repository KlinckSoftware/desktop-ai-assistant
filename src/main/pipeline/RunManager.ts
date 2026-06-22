import { appState } from '../state'
import { CH, type PipelineStep, type PipelineUpdate, type RunInfo } from '../../shared/types'
import { capReached } from '../budget'
import type { PipelineRunner } from './PipelineRunner'

// Main-side authority for pipeline runs. Runs are serialized (one at a time):
// a second start() queues behind the active run, so two runs never fight over
// worktrees/resources. The manager owns each run's accumulated updates and
// status, so a run survives the panel being closed (background) and a reopened
// panel can re-render in-flight runs via list(). Scheduled runs (RunManager is
// also the scheduler's entry point) go through the exact same path.

const MAX_RECORDS = 40

function label(input: string, steps: PipelineStep[]): string {
  const base = (input || steps[0]?.instruction || 'run').replace(/\s+/g, ' ').trim()
  return base.slice(0, 40) || 'run'
}

export class RunManager {
  private runs = new Map<string, RunInfo>()
  private order: string[] = [] // newest-first run ids
  private queue: string[] = []
  private activeId: string | null = null
  private seq = 0

  constructor(private runner: PipelineRunner) {}

  /** Queue a run; returns its id immediately. Executes when the queue reaches it.
   *  `allowFull` opts the run into autonomous shell for `full` steps. */
  start(steps: PipelineStep[], input: string, dryRun = false, allowFull = false): string {
    const id = `run-${Date.now().toString(36)}-${++this.seq}`
    const rec: RunInfo = {
      id,
      ts: Date.now(),
      input,
      dryRun,
      allowFull,
      label: label(input, steps),
      status: 'queued',
      steps,
      updates: []
    }
    this.runs.set(id, rec)
    this.order.unshift(id)
    this.prune()
    // Refuse to even start when the session cost cap is already reached — the
    // main-side backstop for unattended (scheduled/background) runs.
    if (capReached()) {
      rec.status = 'error'
      this.onUpdate(id, { type: 'error', text: '[blocked: session cost cap reached — raise it in Settings]' })
      appState.send(CH.runComplete, rec)
      return id
    }
    this.broadcast({ type: 'queued', runId: id })
    this.queue.push(id)
    void this.pump()
    return id
  }

  /** Cancel an active run (aborts the in-flight model call) or drop a queued one. */
  cancel(id: string): void {
    if (id === this.activeId) {
      this.runner.cancel()
      return
    }
    const qi = this.queue.indexOf(id)
    if (qi >= 0) {
      this.queue.splice(qi, 1)
      const rec = this.runs.get(id)
      if (rec) {
        rec.status = 'cancelled'
        this.broadcast({ type: 'error', runId: id, text: 'Cancelled.' })
        appState.send(CH.runComplete, rec)
      }
    }
  }

  /** Active + recent runs, newest first — for panel mount / history. */
  list(): RunInfo[] {
    return this.order.map((id) => this.runs.get(id)!).filter(Boolean)
  }

  get(id: string): RunInfo | undefined {
    return this.runs.get(id)
  }

  /** Drop all recorded runs except any still queued/running (privacy: clear history). */
  clear(): void {
    const keep = new Set([this.activeId, ...this.queue].filter(Boolean) as string[])
    for (const id of [...this.runs.keys()]) if (!keep.has(id)) this.runs.delete(id)
    this.order = this.order.filter((id) => keep.has(id))
  }

  private async pump(): Promise<void> {
    if (this.activeId || this.queue.length === 0) return
    const id = this.queue.shift()!
    const rec = this.runs.get(id)
    if (!rec) return void this.pump()
    this.activeId = id
    rec.status = 'running'
    this.broadcast({ type: 'started', runId: id, name: rec.label })
    try {
      await this.runner.run(rec.steps, rec.input, rec.dryRun, (u) => this.onUpdate(id, u), id, rec.allowFull)
    } catch (err) {
      this.onUpdate(id, { type: 'error', text: err instanceof Error ? err.message : String(err) })
    }
    // Settle status from the terminal update (done/error already set it).
    if (rec.status === 'running') rec.status = 'done'
    this.activeId = null
    appState.send(CH.runComplete, rec)
    void this.pump()
  }

  // Append to the run's record, derive status, and broadcast tagged with runId.
  private onUpdate(id: string, u: PipelineUpdate): void {
    const rec = this.runs.get(id)
    if (!rec) return
    const tagged: PipelineUpdate = { ...u, runId: id }
    rec.updates.push(tagged)
    if (u.type === 'done') rec.status = 'done'
    else if (u.type === 'error') rec.status = rec.status === 'cancelled' ? 'cancelled' : 'error'
    this.broadcast(tagged)
  }

  private broadcast(u: PipelineUpdate): void {
    appState.send(CH.pipelineUpdate, u)
  }

  private prune(): void {
    while (this.order.length > MAX_RECORDS) {
      const id = this.order.pop()
      if (id && id !== this.activeId && !this.queue.includes(id)) this.runs.delete(id)
    }
  }
}
