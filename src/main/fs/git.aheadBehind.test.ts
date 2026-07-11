import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process.execFile (what util.promisify wraps) so these tests never
// shell out to real git. Same style as git.pr.test.ts.
type ExecCb = (err: unknown, result: { stdout: string; stderr: string }) => void
const execFileMock = vi.fn()

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}))

import { aheadBehind } from './git'

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

describe('aheadBehind', () => {
  beforeEach(() => execFileMock.mockReset())

  it('parses "<behind>\\t<ahead>" from rev-list --left-right --count', async () => {
    respond('2\t5\n')
    expect(await aheadBehind('/wt', 'main')).toEqual({ ahead: 5, behind: 2 })
  })

  it('parses space-separated output too', async () => {
    respond('0 3\n')
    expect(await aheadBehind('/wt', 'main')).toEqual({ ahead: 3, behind: 0 })
  })

  it('returns null when the git call fails (e.g. base unreachable)', async () => {
    fail({ stderr: 'unknown revision' })
    expect(await aheadBehind('/wt', 'main')).toBeNull()
  })

  it('returns null on unparseable output', async () => {
    respond('not-a-number\n')
    expect(await aheadBehind('/wt', 'main')).toBeNull()
  })
})
