import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

// Ticket #17: Gemini pipeline steps should load actual image bytes for refs
// found in their resolved input — from the generated-images dir (Imagen output
// carried from an earlier step) or, failing that, from the run's worktree via
// FileSystemManager.readImage. Refs that can't be loaded are silently skipped.

const TMP_USERDATA = vi.hoisted(() =>
  require('path').join(require('os').tmpdir(), `pipeline-vision-test-${process.pid}`)
)
const GENERATED_DIR = vi.hoisted(() => require('path').join(TMP_USERDATA, 'generated-images'))

vi.mock('electron', () => ({ app: { getPath: () => TMP_USERDATA } }))

vi.mock('../state', () => ({
  appState: {
    send: vi.fn(),
    projectRoot: '/project',
    settings: { isolateAgents: false, claudeModel: '', claudeEffort: '', autonomousAllow: '' },
    setSessionRoot: vi.fn(),
    rootFor: vi.fn(() => '/project')
  }
}))

vi.mock('../worktree/WorktreeManager', () => ({
  worktreeManager: { create: vi.fn(), setLabel: vi.fn() }
}))

vi.mock('../api/providers', () => ({ listProviders: vi.fn(async () => []) }))

// The shared FileSystemManager singleton PipelineRunner reads via getFsm().
const readImageMock = vi.hoisted(() => vi.fn())
vi.mock('../tools/toolExec', () => ({
  getFsm: () => ({ readImage: readImageMock })
}))

import { PipelineRunner } from './PipelineRunner'
import type { IPCModerator } from '../moderator/IPCModerator'
import type { PipelineStep } from '../../shared/types'

describe('PipelineRunner vision pass-through (Gemini steps)', () => {
  let completeMock: ReturnType<typeof vi.fn>
  let moderator: IPCModerator

  beforeEach(() => {
    vi.clearAllMocks()
    completeMock = vi.fn(async () => 'gemini says hi')
    moderator = {
      listDebateAgents: vi.fn(async () => [{ id: 'gemini', name: 'Gemini', kind: 'gemini' }])
    } as unknown as IPCModerator
  })

  function makeRunner(): PipelineRunner {
    const gemini = { complete: completeMock } as never
    return new PipelineRunner(gemini, moderator)
  }

  it('loads a generated-image ref (bare filename) and passes it as an ImagePart to gemini.complete', async () => {
    readImageMock.mockResolvedValue({ mime: 'image/png', base64: 'ZmFrZS1wbmc=' })
    const runner = makeRunner()
    const steps: PipelineStep[] = [{ id: 's1', agentId: 'gemini', instruction: 'look at img_1_abc.png and describe it' }]

    const updates: { type: string; text?: string }[] = []
    await runner.run(steps, 'go', false, (u) => updates.push(u))

    expect(completeMock).toHaveBeenCalledTimes(1)
    const [prompt, history, signal, images] = completeMock.mock.calls[0]
    expect(prompt).toContain('img_1_abc.png')
    expect(history).toEqual([])
    expect(signal).toBeDefined()
    expect(images).toEqual([{ mime: 'image/png', base64: 'ZmFrZS1wbmc=' }])

    // Confirms the confined generated-images path was what got read.
    expect(readImageMock).toHaveBeenCalledWith(join(GENERATED_DIR, 'img_1_abc.png'))

    expect(updates.some((u) => u.type === 'done')).toBe(true)
  })

  it('falls back to FileSystemManager.readImage under the run root for a non-generated ref', async () => {
    // First call (generated-images attempt) fails, second (workRoot attempt) succeeds.
    readImageMock.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce({
      mime: 'image/jpeg',
      base64: 'c29tZS1qcGVn'
    })
    const runner = makeRunner()
    const steps: PipelineStep[] = [{ id: 's1', agentId: 'gemini', instruction: 'check assets/cat.jpg please' }]

    await runner.run(steps, 'go', false, () => {})

    expect(completeMock).toHaveBeenCalledTimes(1)
    const images = completeMock.mock.calls[0][3]
    expect(images).toEqual([{ mime: 'image/jpeg', base64: 'c29tZS1qcGVn' }])
  })

  it('silently skips a ref that fails to load under both paths — step still completes', async () => {
    readImageMock.mockRejectedValue(new Error('ENOENT'))
    const runner = makeRunner()
    const steps: PipelineStep[] = [{ id: 's1', agentId: 'gemini', instruction: 'missing.png is gone' }]

    const updates: { type: string; text?: string }[] = []
    await runner.run(steps, 'go', false, (u) => updates.push(u))

    expect(completeMock).toHaveBeenCalledTimes(1)
    const images = completeMock.mock.calls[0][3]
    expect(images).toEqual([])
    expect(updates.some((u) => u.type === 'done')).toBe(true)
    expect(updates.some((u) => u.type === 'error')).toBe(false)
  })

  it('a step whose input has no image refs passes an empty images array (no fs calls)', async () => {
    const runner = makeRunner()
    const steps: PipelineStep[] = [{ id: 's1', agentId: 'gemini', instruction: 'just text, no pictures' }]

    await runner.run(steps, 'go', false, () => {})

    expect(readImageMock).not.toHaveBeenCalled()
    const images = completeMock.mock.calls[0][3]
    expect(images).toEqual([])
  })
})
