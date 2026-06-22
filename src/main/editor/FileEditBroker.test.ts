import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../state', () => ({
  appState: { projectRoot: process.cwd(), send: vi.fn(), settings: { allowProtectedWrites: false } }
}))

import { FileEditBroker } from './FileEditBroker'
import { policyForStep } from '../policy/ApprovalPolicy'
import type { FileSystemManager } from '../fs/FileSystemManager'

function makeBroker() {
  const writeFile = vi.fn(async () => {})
  const readFile = vi.fn(async () => {
    throw new Error('new file')
  })
  const broker = new FileEditBroker({ writeFile, readFile } as unknown as FileSystemManager)
  return { broker, writeFile }
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
