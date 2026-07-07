import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state', () => ({
  appState: { projectRoot: process.cwd(), send: vi.fn(), settings: { allowProtectedWrites: false } }
}))

import { FileEditBroker } from './FileEditBroker'
import { policyForStep } from '../policy/ApprovalPolicy'
import type { FileSystemManager } from '../fs/FileSystemManager'

function makeBroker(existingContent?: string) {
  const writeFile = vi.fn(async () => {})
  const deleteFile = vi.fn(async () => {})
  const readFile = vi.fn(async () => {
    if (existingContent !== undefined) return existingContent
    throw new Error('new file')
  })
  const broker = new FileEditBroker({ writeFile, readFile, deleteFile } as unknown as FileSystemManager)
  return { broker, writeFile, deleteFile }
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
