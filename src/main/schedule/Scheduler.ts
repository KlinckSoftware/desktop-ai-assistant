import { appState } from '../state'
import { CH, type ScheduledJob } from '../../shared/types'
import type { RunManager } from '../pipeline/RunManager'
import type { JobStore } from './JobStore'
import type { FileSystemManager } from '../fs/FileSystemManager'

// In-app scheduler for pipeline jobs. Ticks while the app is open (a true
// fire-when-closed scheduler would need a headless launch mode — out of scope).
// Time triggers (interval/daily) are polled; the git trigger fires on debounced
// project changes. Jobs run through RunManager, which serializes them, so a
// scheduled run never collides with a manual one. Pipeline steps are always
// autonomous (never interactive), so unattended execution is inherently safe.

const TICK_MS = 30_000
const GIT_DEBOUNCE_MS = 4_000
const GIT_MIN_GAP_MS = 60_000 // don't refire a git job more than once a minute

/** Local 'HH:MM' for a timestamp. */
export function localHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Pure due-check for time triggers (exported for tests). `git` triggers are
 * event-driven, not polled, so they're never due here.
 */
export function isDue(job: ScheduledJob, now: number, hhmm: string): boolean {
  if (!job.enabled) return false
  const t = job.trigger
  if (t.kind === 'interval') {
    return now - (job.lastRun ?? 0) >= Math.max(1, t.minutes) * 60_000
  }
  if (t.kind === 'daily') {
    // Fire when the local clock matches, but only once per occurrence (the 30s
    // ticks within the same minute are guarded by the 60s since-lastRun gap).
    return hhmm === t.time && now - (job.lastRun ?? 0) > 60_000
  }
  return false
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private gitTimer: ReturnType<typeof setTimeout> | null = null
  private offChange: (() => void) | null = null

  constructor(
    private runManager: RunManager,
    private store: JobStore,
    private fsm: FileSystemManager
  ) {}

  async start(): Promise<void> {
    await this.store.load()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.offChange = this.fsm.onChange(() => this.onGitChange())
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.gitTimer) clearTimeout(this.gitTimer)
    this.offChange?.()
    this.timer = null
  }

  private tick(): void {
    const now = Date.now()
    const hhmm = localHHMM(new Date())
    for (const job of this.store.list()) {
      if (isDue(job, now, hhmm)) void this.fire(job)
    }
  }

  // Debounced project-change handler for git-triggered jobs.
  private onGitChange(): void {
    if (this.gitTimer) clearTimeout(this.gitTimer)
    this.gitTimer = setTimeout(() => {
      const now = Date.now()
      for (const job of this.store.list()) {
        if (job.enabled && job.trigger.kind === 'git' && now - (job.lastRun ?? 0) > GIT_MIN_GAP_MS) {
          void this.fire(job)
        }
      }
    }, GIT_DEBOUNCE_MS)
  }

  /** Run a job now (also the manual "run now" path). Returns the run id. */
  async fire(job: ScheduledJob): Promise<string> {
    job.lastRun = Date.now()
    await this.store.flush()
    appState.send(CH.jobsChanged)
    return this.runManager.start(job.steps, job.input, false)
  }
}
