import { randomUUID } from 'node:crypto'
import { resolve, relative, sep } from 'path'
import { appState } from '../state'
import { CH, type AgentId, type PendingEdit, type Checkpoint } from '../../shared/types'
import { decide, type ApprovalPolicy } from '../policy/ApprovalPolicy'
import { isProtectedPath } from '../../shared/protectedPath'
import type { FileSystemManager } from '../fs/FileSystemManager'

// Default-deny gate for agent-proposed file writes (```file <path>``` blocks).
// Every edit is previewed (old vs new) and must be approved. Before applying,
// the pre-edit content is snapshotted as a checkpoint so the write can be undone.
//
// Nonce proof-of-human-approval (mirrors CommandBroker/ToolBroker): each pending
// edit is minted with a cryptographically random, single-use nonce (node:crypto
// randomUUID) sent to the renderer alongside the id, as part of the PendingEdit
// itself. approve()/reject() must echo that exact nonce back; main refuses to
// act on a mismatched or missing nonce, since the sequential id alone is
// guessable by a compromised renderer.

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

  // Resolve an agent path against its session root (confined) and snapshot old
  // content. `sessionRoot` is the agent's worktree when isolated, else the shared
  // project root; it stays inside projectRoot, so fsm's own confinement holds and
  // `rel` reads relative to the agent's tree (e.g. src/x, not .dai-trees/…/src/x).
  private async buildEdit(
    agentPath: string,
    newContent: string,
    origin: AgentId,
    sessionRoot?: string
  ): Promise<PendingEdit | string> {
    const root = resolve(sessionRoot || appState.projectRoot)
    const abs = resolve(root, agentPath)
    if (abs !== root && !abs.startsWith(root + sep)) {
      return `[edit rejected: path outside project root: ${agentPath}]`
    }
    const rel = relative(root, abs).split(sep).join('/')
    // Block .git/ and node_modules/ writes (git-hook RCE / dependency tampering)
    // unless the user explicitly loosened this in Settings.
    if (!appState.settings.allowProtectedWrites && isProtectedPath(rel)) {
      return `[edit rejected: protected path: ${rel}]`
    }
    let oldContent = ''
    let isNew = false
    try {
      oldContent = await this.fsm.readFile(abs)
    } catch {
      isNew = true // new file (or unreadable/binary — treated as create)
    }
    return { id: `edit_${++this.seq}`, path: abs, rel, oldContent, newContent, isNew, origin, nonce: randomUUID() }
  }

  /** Propose a file write. Resolves with an outcome string fed back to the agent. */
  async propose(agentPath: string, newContent: string, origin: AgentId, sessionRoot?: string): Promise<string> {
    const edit = await this.buildEdit(agentPath, newContent, origin, sessionRoot)
    if (typeof edit === 'string') return edit
    appState.send(CH.editPending, edit)
    return new Promise((res) => this.pending.set(edit.id, { edit, resolve: res }))
  }

  /** Apply a file write under an ApprovalPolicy (autonomous/dry-run pipeline path).
   *  `kind` is 'apply_edit' or 'write_file' for allowlist matching. */
  async runWithPolicy(
    agentPath: string,
    newContent: string,
    origin: AgentId,
    kind: string,
    policy: ApprovalPolicy,
    sessionRoot?: string
  ): Promise<string> {
    const edit = await this.buildEdit(agentPath, newContent, origin, sessionRoot)
    if (typeof edit === 'string') return edit
    const d = decide(policy, kind)
    switch (d.action) {
      case 'interactive':
        appState.send(CH.editPending, edit)
        return new Promise((res) => this.pending.set(edit.id, { edit, resolve: res }))
      case 'dryrun':
        return `[dry-run] would ${edit.isNew ? 'create' : 'edit'} ${edit.rel} (${newContent.length} chars)`
      case 'block':
        console.warn(`[policy] blocked edit to ${edit.rel} — ${d.reason}`)
        return `[blocked by policy: ${d.reason}]`
      case 'run':
        return this.apply(edit)
    }
  }

  // Verify the caller's nonce matches the one minted for this pending id. On a
  // mismatch (or an id that already resolved) this blocks the action, removes
  // the pending entry so the nonce cannot be reused, logs a warning, and
  // resolves the original promise so the model is not left waiting forever.
  private verifyNonce(id: string, nonce: string, action: string): Pending | undefined {
    const p = this.pending.get(id)
    if (!p) return undefined
    if (p.edit.nonce !== nonce) {
      this.pending.delete(id)
      console.warn(`[security] ${action}() nonce mismatch for edit ${id} (${p.edit.rel}) — refusing to apply`)
      appState.send(CH.editResult, { id, rel: p.edit.rel, outcome: 'blocked: approval nonce mismatch' })
      p.resolve('[blocked: approval nonce mismatch]')
      return undefined
    }
    return p
  }

  async approve(id: string, nonce: string): Promise<void> {
    const p = this.verifyNonce(id, nonce, 'approve')
    if (!p) return
    this.pending.delete(id)
    p.resolve(await this.apply(p.edit))
  }

  // Snapshot pre-edit state as a checkpoint, then write. Shared by approve()
  // and the autonomous policy path so checkpoints/undo cover both.
  private async apply(edit: PendingEdit): Promise<string> {
    const id = edit.id
    try {
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
      return `[applied edit to ${edit.rel}]`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appState.send(CH.editResult, { id, rel: edit.rel, outcome: `failed: ${msg}` })
      return `[edit to ${edit.rel} failed: ${msg}]`
    }
  }

  reject(id: string, nonce: string): void {
    const p = this.verifyNonce(id, nonce, 'reject')
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
      if (c.existed) {
        await this.fsm.writeFile(c.meta.path, c.oldContent)
      } else {
        // The checkpoint was a file creation — undo removes the file entirely
        // instead of leaving an empty husk behind.
        await this.fsm.deleteFile(c.meta.path)
      }
    } catch {
      /* ignore */
    }
    this.checkpoints.splice(idx, 1)
    appState.send(CH.checkpointChanged)
  }
}
