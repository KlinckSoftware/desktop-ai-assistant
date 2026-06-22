import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { ScheduledJob } from '../../shared/types'

// Persists scheduled jobs to jobs.json in userData (same pattern as state.json /
// agents.json). Best-effort: a read failure yields an empty list.

const file = (): string => join(app.getPath('userData'), 'jobs.json')

export class JobStore {
  private jobs: ScheduledJob[] = []
  private loaded = false

  async load(): Promise<ScheduledJob[]> {
    try {
      this.jobs = JSON.parse(await fs.readFile(file(), 'utf-8'))
    } catch {
      this.jobs = []
    }
    this.loaded = true
    return this.jobs
  }

  list(): ScheduledJob[] {
    return this.jobs
  }

  /** Add or replace a job (matched by id). Returns the new list. */
  async save(job: ScheduledJob): Promise<ScheduledJob[]> {
    if (!this.loaded) await this.load()
    const i = this.jobs.findIndex((j) => j.id === job.id)
    if (i >= 0) this.jobs[i] = job
    else this.jobs.push(job)
    await this.flush()
    return this.jobs
  }

  async remove(id: string): Promise<ScheduledJob[]> {
    if (!this.loaded) await this.load()
    this.jobs = this.jobs.filter((j) => j.id !== id)
    await this.flush()
    return this.jobs
  }

  /** Persist a mutation made in place (e.g. lastRun bumped by the scheduler). */
  async flush(): Promise<void> {
    try {
      await fs.writeFile(file(), JSON.stringify(this.jobs, null, 2), 'utf-8')
    } catch (err) {
      console.warn('[jobs] save failed:', (err as Error)?.message ?? err)
    }
  }
}

export const jobStore = new JobStore()
