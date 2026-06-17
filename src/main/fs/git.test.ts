import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { parseStatusMap, parseChanges } from './git'

const ROOT = '/proj'
const abs = (rel: string): string => join(ROOT, rel) // platform-correct separators

describe('parseStatusMap', () => {
  it('maps absolute path -> trimmed code', () => {
    const out = ' M src/a.ts\n?? new.txt\nA  staged.ts\n'
    const map = parseStatusMap(out, ROOT)
    expect(map[abs('src/a.ts')]).toBe('M')
    expect(map[abs('new.txt')]).toBe('??')
    expect(map[abs('staged.ts')]).toBe('A')
  })

  it('handles renames (takes new name) and quotes', () => {
    const out = 'R  old.ts -> "new name.ts"\n'
    const map = parseStatusMap(out, ROOT)
    expect(map[abs('new name.ts')]).toBe('R')
  })
})

describe('parseChanges', () => {
  it('splits staged vs unstaged from XY codes', () => {
    // X (index) M => staged; Y (worktree) M => unstaged
    const out = 'M  staged.ts\n M unstaged.ts\nMM both.ts\n?? untracked.ts\n'
    const { staged, unstaged } = parseChanges(out, ROOT)
    const sRel = staged.map((c) => c.rel).sort()
    const uRel = unstaged.map((c) => c.rel).sort()
    expect(sRel).toEqual(['both.ts', 'staged.ts'])
    expect(uRel).toEqual(['both.ts', 'unstaged.ts', 'untracked.ts'])
    // untracked (??) is unstaged only
    expect(uRel).not.toContain('staged.ts')
    expect(unstaged.some((c) => c.rel === 'untracked.ts')).toBe(true)
    expect(staged.some((c) => c.rel === 'untracked.ts')).toBe(false)
  })

  it('produces absolute paths', () => {
    const { unstaged } = parseChanges(' M a.ts\n', ROOT)
    expect(unstaged[0].path).toBe(abs('a.ts'))
  })
})
