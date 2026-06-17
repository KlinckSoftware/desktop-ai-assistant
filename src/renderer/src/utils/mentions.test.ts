import { describe, it, expect, beforeEach, vi } from 'vitest'
import { expandMentions } from './mentions'

// Stub the preload bridge the util depends on.
const readFile = vi.fn()
beforeEach(() => {
  readFile.mockReset()
  // @ts-expect-error test stub
  globalThis.window = { api: { fs: { readFile } } }
})

describe('expandMentions', () => {
  it('returns prompt unchanged when there are no mentions', async () => {
    const out = await expandMentions('hello world', '/proj')
    expect(out).toBe('hello world')
    expect(readFile).not.toHaveBeenCalled()
  })

  it('inlines a referenced file resolved against the project root', async () => {
    readFile.mockResolvedValue('file body')
    const out = await expandMentions('look at @src/a.ts please', '/proj')
    expect(readFile).toHaveBeenCalledWith('/proj/src/a.ts')
    expect(out).toContain('### @src/a.ts')
    expect(out).toContain('file body')
    expect(out.startsWith('look at @src/a.ts please')).toBe(true)
  })

  it('leaves unreadable mentions as literal text', async () => {
    readFile.mockRejectedValue(new Error('nope'))
    const out = await expandMentions('@ghost.ts', '/proj')
    expect(out).toBe('@ghost.ts')
  })

  it('dedupes repeated mentions', async () => {
    readFile.mockResolvedValue('x')
    await expandMentions('@a.ts and again @a.ts', '/proj')
    expect(readFile).toHaveBeenCalledTimes(1)
  })
})
