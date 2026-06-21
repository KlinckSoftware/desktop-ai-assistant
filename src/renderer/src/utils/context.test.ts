import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildContextBlock, buildCliContext } from './context'

const readFile = vi.fn()
const repoMap = vi.fn()
beforeEach(() => {
  readFile.mockReset()
  repoMap.mockReset()
  // @ts-expect-error test stub
  globalThis.window = { api: { fs: { readFile, repoMap } } }
})

describe('buildContextBlock', () => {
  it('returns empty string when nothing is pooled', async () => {
    expect(await buildContextBlock([], false)).toBe('')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('inlines pooled file contents fenced', async () => {
    readFile.mockResolvedValue('the body')
    const out = await buildContextBlock(['/proj/src/a.ts'], false)
    expect(out).toContain('### File: a.ts (/proj/src/a.ts)')
    expect(out).toContain('the body')
    expect(out).toContain('1 file(s)')
  })

  it('notes unreadable files instead of throwing', async () => {
    readFile.mockRejectedValue(new Error('binary'))
    const out = await buildContextBlock(['/proj/x.bin'], false)
    expect(out).toContain('[unreadable]')
  })

  it('prepends the repo map when requested', async () => {
    repoMap.mockResolvedValue('REPO MAP TEXT')
    readFile.mockResolvedValue('body')
    const out = await buildContextBlock(['/proj/a.ts'], true)
    expect(out.startsWith('REPO MAP TEXT')).toBe(true)
    expect(out).toContain('body')
  })
})

describe('buildCliContext', () => {
  it('returns empty when nothing pooled and no repo map', async () => {
    expect(await buildCliContext([], false, '/proj')).toBe('')
  })

  it('lists pooled files as project-relative forward-slash paths (no inlined content)', async () => {
    const out = await buildCliContext(['/proj/src/a.ts', '/proj/b.ts'], false, '/proj')
    expect(out).toContain('- src/a.ts')
    expect(out).toContain('- b.ts')
    expect(readFile).not.toHaveBeenCalled() // CLI reads files itself
  })

  it('normalizes backslash roots and paths to forward slashes', async () => {
    const out = await buildCliContext(['C:\\proj\\src\\a.ts'], false, 'C:\\proj')
    expect(out).toContain('- src/a.ts')
  })

  it('inlines the repo map text when enabled', async () => {
    repoMap.mockResolvedValue('MAP')
    const out = await buildCliContext([], true, '/proj')
    expect(out).toContain('MAP')
  })
})
