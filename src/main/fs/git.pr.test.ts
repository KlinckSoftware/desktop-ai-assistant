import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process.execFile (what util.promisify wraps) so these tests never
// shell out to real git/gh. Each test configures the callback behavior per call.
type ExecCb = (err: unknown, result: { stdout: string; stderr: string }) => void
const execFileMock = vi.fn()

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

import { hasOriginRemote, ghAvailable, pushBranch, ghPrCreate, ghPrView } from './git'

// Drive the promisified execFile: the last arg is always the Node-style callback.
function respond(stdout: string, stderr = ''): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecCb
    cb(null, { stdout, stderr })
  })
}
function fail(err: Record<string, unknown>): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecCb
    cb(err, { stdout: '', stderr: '' })
  })
}

describe('git.ts PR helpers', () => {
  beforeEach(() => execFileMock.mockReset())

  describe('hasOriginRemote', () => {
    it('true when origin resolves to a URL', async () => {
      respond('https://github.com/o/r.git\n')
      expect(await hasOriginRemote('/repo')).toBe(true)
    })
    it('false when the remote lookup fails (no origin)', async () => {
      fail({ message: 'no such remote' })
      expect(await hasOriginRemote('/repo')).toBe(false)
    })
  })

  describe('ghAvailable', () => {
    it('true when gh --version succeeds', async () => {
      respond('gh version 2.0.0\n')
      expect(await ghAvailable()).toBe(true)
    })
    it('false when gh is not on PATH', async () => {
      fail({ code: 'ENOENT' })
      expect(await ghAvailable()).toBe(false)
    })
  })

  describe('pushBranch', () => {
    it('resolves on a successful push', async () => {
      respond('')
      await expect(pushBranch('/wt', 'agent/x')).resolves.toBeUndefined()
    })
    it('throws on a rejected push', async () => {
      fail({ stderr: 'remote rejected' })
      await expect(pushBranch('/wt', 'agent/x')).rejects.toBeTruthy()
    })
  })

  describe('ghPrCreate', () => {
    it('extracts the PR URL from gh output', async () => {
      respond('Creating pull request...\nhttps://github.com/o/r/pull/42\n')
      const url = await ghPrCreate('/wt', 'agent/x', 'title', 'body')
      expect(url).toBe('https://github.com/o/r/pull/42')
    })

    it('falls back to gh pr view when a PR already exists', async () => {
      fail({ stderr: 'a pull request for branch already exists' })
      respond('https://github.com/o/r/pull/7\n') // gh pr view
      const url = await ghPrCreate('/wt', 'agent/x', 'title', 'body')
      expect(url).toBe('https://github.com/o/r/pull/7')
    })

    it('throws when create fails and no existing PR is found', async () => {
      fail({ stderr: 'create failed' }) // pr create
      fail({ stderr: 'no PR' }) // pr view fallback
      await expect(ghPrCreate('/wt', 'agent/x', 'title', 'body')).rejects.toThrow('create failed')
    })
  })

  describe('ghPrView', () => {
    it('returns the URL', async () => {
      respond('https://github.com/o/r/pull/3\n')
      expect(await ghPrView('/wt', 'agent/x')).toBe('https://github.com/o/r/pull/3')
    })
    it('throws when output is empty', async () => {
      respond('')
      await expect(ghPrView('/wt', 'agent/x')).rejects.toThrow('no PR found')
    })
  })
})
