import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state', () => ({
  appState: { projectRoot: process.cwd(), send: vi.fn(), settings: { allowProtectedWrites: false } }
}))

import { appState } from '../state'
import { FileEditBroker } from './FileEditBroker'
import { policyForStep } from '../policy/ApprovalPolicy'
import type { FileSystemManager } from '../fs/FileSystemManager'
import type { PendingEdit } from '../../shared/types'

function makeBroker(existingContent?: string) {
  const writeFile = vi.fn(async (_path: string, _content: string) => {})
  const deleteFile = vi.fn(async (_path: string) => {})
  const readFile = vi.fn(async () => {
    if (existingContent !== undefined) return existingContent
    throw new Error('new file')
  })
  const broker = new FileEditBroker({ writeFile, readFile, deleteFile } as unknown as FileSystemManager)
  return { broker, writeFile, deleteFile }
}

// Pull the nonce main minted for the most recently proposed edit out of the
// mocked appState.send('edit:pending', ...) call, the way the renderer would
// read it off the PendingEdit payload it received.
function lastNonce(): string {
  const calls = (appState.send as ReturnType<typeof vi.fn>).mock.calls
  const pendingCall = [...calls].reverse().find((c) => c[0] === 'edit:pending')
  return (pendingCall?.[1] as PendingEdit).nonce
}

describe('FileEditBroker.runWithPolicy', () => {
  let broker: FileEditBroker
  let writeFile: ReturnType<typeof vi.fn>
  beforeEach(() => {
    ;({ broker, writeFile } = makeBroker())
  })

  it('edit preset: applies a write_file', async () => {
    const out = await broker.runWithPolicy('note.txt', 'hi', 'api', 'write_file', policyForStep('edit', false))
    expect(out).toMatch(/applied edit/i)
    expect(writeFile).toHaveBeenCalledOnce()
  })

  it('read-only preset: blocks write_file (no disk write)', async () => {
    const out = await broker.runWithPolicy('note.txt', 'hi', 'api', 'write_file', policyForStep('read-only', false))
    expect(out).toMatch(/blocked by policy/i)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('dry-run: reports intent, no write', async () => {
    const out = await broker.runWithPolicy('note.txt', 'hello', 'api', 'write_file', policyForStep('full', true))
    expect(out).toMatch(/\[dry-run\]/)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('rejects a path outside the project root', async () => {
    const out = await broker.runWithPolicy('../escape.txt', 'x', 'api', 'write_file', policyForStep('edit', false))
    expect(out).toMatch(/outside project root/i)
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('FileEditBroker nonce gate (proves approvals are human-initiated)', () => {
  let broker: FileEditBroker
  let writeFile: ReturnType<typeof vi.fn>
  beforeEach(() => {
    ;({ broker, writeFile } = makeBroker())
  })

  it('approve() with the WRONG nonce is blocked — nothing is written, the promise resolves with a blocked message', async () => {
    const p = broker.propose('note.txt', 'hi', 'api')
    // propose() is async (buildEdit reads the old file content before the
    // pending entry is registered) — let that registration settle before
    // approving, exactly as the renderer would only be able to approve after
    // receiving the onPending event.
    await Promise.resolve()
    await Promise.resolve()
    await broker.approve('edit_1', 'a-completely-wrong-guessed-nonce')
    expect(await p).toMatch(/blocked: approval nonce mismatch/i)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('approve() with the CORRECT nonce applies the edit', async () => {
    const p = broker.propose('note.txt', 'hi', 'api')
    await Promise.resolve()
    await Promise.resolve()
    await broker.approve('edit_1', lastNonce())
    expect(await p).toMatch(/applied edit/i)
    expect(writeFile).toHaveBeenCalledOnce()
  })

  it('reject() with the wrong nonce is blocked', async () => {
    const p = broker.propose('note.txt', 'hi', 'api')
    await Promise.resolve()
    await Promise.resolve()
    broker.reject('edit_1', 'wrong-nonce')
    expect(await p).toMatch(/blocked: approval nonce mismatch/i)
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('FileEditBroker.undo', () => {
  it('undo of a file creation deletes the file (no empty husk)', async () => {
    const { broker, deleteFile, writeFile } = makeBroker() // readFile throws -> isNew
    await broker.runWithPolicy('fresh.txt', 'hello', 'api', 'write_file', policyForStep('edit', false))
    const [ckpt] = broker.list()
    expect(ckpt.label).toMatch(/^create /)
    writeFile.mockClear()
    await broker.undo(ckpt.id)
    expect(deleteFile).toHaveBeenCalledOnce()
    expect(writeFile).not.toHaveBeenCalled()
    expect(broker.list()).toHaveLength(0)
  })

  it('undo of an edit restores the prior content', async () => {
    const { broker, deleteFile, writeFile } = makeBroker('old content')
    await broker.runWithPolicy('existing.txt', 'new content', 'api', 'write_file', policyForStep('edit', false))
    const [ckpt] = broker.list()
    expect(ckpt.label).toMatch(/^edit /)
    writeFile.mockClear()
    await broker.undo(ckpt.id)
    expect(deleteFile).not.toHaveBeenCalled()
    expect(writeFile).toHaveBeenCalledOnce()
    expect(writeFile.mock.calls[0][1]).toBe('old content')
  })
})
