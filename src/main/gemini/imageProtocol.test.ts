import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  net: { fetch: vi.fn() }
}))

import { resolveConfinedImagePath } from './imageProtocol'

describe('resolveConfinedImagePath', () => {
  const base = join('C:', 'fake', 'userData', 'generated-images')

  it('resolves a plain filename inside the base dir', () => {
    const result = resolveConfinedImagePath(base, 'img_123_abc.png')
    expect(result).toBe(join(base, 'img_123_abc.png'))
  })

  it('rejects a parent-traversal attempt (../../etc/passwd)', () => {
    expect(resolveConfinedImagePath(base, '../../etc/passwd')).toBeNull()
  })

  it('does not let an embedded drive-letter path escape the base dir (nests instead of jumping)', () => {
    // path.join does not restart on an absolute-looking second segment, so this
    // resolves to a (nonexistent, 404) path *inside* base — never a real escape.
    const result = resolveConfinedImagePath(base, 'C:\\Windows\\System32\\drivers\\etc\\hosts')
    expect(result).not.toBeNull()
    expect(result as string).toMatch(new RegExp(`^${base.replace(/\\/g, '\\\\')}`))
  })

  it('rejects a sneaky traversal that still starts with the base prefix as a string', () => {
    // e.g. "generated-images-evil/secret.png" should NOT be confused with
    // "generated-images/secret.png" by a naive startsWith(base) check.
    const siblingDir = base + '-evil'
    expect(resolveConfinedImagePath(base, join('..', 'generated-images-evil', 'secret.png'))).toBeNull()
    expect(siblingDir).not.toBe(base) // sanity: they really are different dirs
  })

  it('allows nested-looking but still-confined filenames', () => {
    const result = resolveConfinedImagePath(base, 'img_456_def.png')
    expect(result).toBe(join(base, 'img_456_def.png'))
  })
})
