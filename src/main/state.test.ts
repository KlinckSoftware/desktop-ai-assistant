import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir() },
  BrowserWindow: class {}
}))

import { validRootOr } from './state'

describe('validRootOr', () => {
  it('keeps a root that exists', () => {
    expect(validRootOr(tmpdir())).toBe(tmpdir())
  })

  it('falls back when the root was moved/deleted', () => {
    const dead = `${tmpdir()}/definitely-gone-${Date.now()}`
    const out = validRootOr(dead)
    expect(out).not.toBe(dead)
    expect(out.length).toBeGreaterThan(0)
  })

  it('falls back on an empty root', () => {
    expect(validRootOr('').length).toBeGreaterThan(0)
  })
})
