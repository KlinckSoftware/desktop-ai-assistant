import { resolve, relative, sep } from 'path'
import { appState } from '../state'
import { CH, type AgentId, type PendingEdit, type Checkpoint } from '../../shared/types'
import type { FileSystemManager } from '../fs/FileSystemManager'

// Default-deny gate for agent-proposed file writes (```file <path>``` blocks).
// Every edit is previewed (old vs new) and must be approved. Before applying,
// the pre-edit content is snapshotted as a checkpoint so the write can be undone.

interface Pending {
  edit: PendingEdit
  resolve: (outcome: string) => void
}

interface StoredCheckpoint {
  meta: Omit<Checkpoint, 'ts'>
  oldContent: string
  existed: boolean
}

export class FileEditBroker {
  private pending = new Map<string, Pending>()
  private checkpoints: StoredCheckpoint[] = []
  private seq = 0

  constructor(private fsm: FileSystemManager) {}

  /** Propose a file write. Resolves with an outcome string fed back to the agent. */
  async propose(agentPath: string, newContent: string, origin: AgentId): Promise<string> {
    const root = resolve(appState.projectRoot)
    const abs = resolve(root, agentPath)
    if (abs !== root && !abs.startsWith(root + sep)) {
      return `[edit rejected: path outside project root: ${agentPath}]`
    }
    const rel = relative(root, abs).split(sep).join('/')

    let oldContent = ''
    let isNew = false
    try {
      oldContent = await this.fsm.readFile(abs)
    } catch {
      isNew = true // new file (or unreadable/binary — treated as create)
    }

    const id = `edit_${++this.seq}`
    const edit: PendingEdit = { id, path: abs, rel, oldContent, newContent, isNew, origin }
    appState.send(CH.editPending, edit)
    return new Promise((res) => this.pending.set(id, { edit, resolve: res }))
  }

  async approve(id: string): Promise<void> {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    const { edit } = p
    try {
      // Snapshot pre-edit state, then write.
      this.checkpoints.unshift({
        meta: {
          id: `ckpt_${this.seq}_${edit.id}`,
          rel: edit.rel,
          path: edit.path,
          label: edit.isNew ? `create ${edit.rel}` : `edit ${edit.rel}`
        },
        oldContent: edit.oldContent,
        existed: !edit.isNew
      })
      if (this.checkpoints.length > 100) this.checkpoints.pop()
      await this.fsm.writeFile(edit.path, edit.newContent)
      appState.send(CH.editResult, { id, rel: edit.rel, outcome: 'applied' })
      appState.send(CH.checkpointChanged)
      p.resolve(`[applied edit to ${edit.rel}]`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appState.send(CH.editResult, { id, rel: edit.rel, outcome: `failed: ${msg}` })
      p.resolve(`[edit to ${edit.rel} failed: ${msg}]`)
    }
  }

  reject(id: string): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    appState.send(CH.editResult, { id, rel: p.edit.rel, outcome: 'rejected' })
    p.resolve(`[edit to ${p.edit.rel} rejected by user]`)
  }

  list(): Checkpoint[] {
    // ts is stamped in the renderer (main can't use Date.now in some contexts; fine here, but keep UI authoritative).
    return this.checkpoints.map((c) => ({ ...c.meta, ts: 0 }))
  }

  async undo(checkpointId: string): Promise<void> {
    const idx = this.checkpoints.findIndex((c) => c.meta.id === checkpointId)
    if (idx < 0) return
    const c = this.checkpoints[idx]
    try {
      // Restore prior content. (If the file was newly created, this writes it
      // back to empty — a future enhancement could delete it instead.)
      await this.fsm.writeFile(c.meta.path, c.oldContent)
    } catch {
      /* ignore */
    }
    this.checkpoints.splice(idx, 1)
    appState.send(CH.checkpointChanged)
  }
}
