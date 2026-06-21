import { describe, it, expect } from 'vitest'
import { fileSignatures } from './repoMap'

describe('fileSignatures', () => {
  it('extracts TS declarations and strips trailing braces', () => {
    const src = [
      'import x from "y"',
      'export function foo(a: string): void {',
      '  return',
      '}',
      'class Bar {',
      'export const baz = 1',
      'const internal = 2'
    ].join('\n')
    const sigs = fileSignatures('src/a.ts', src)
    expect(sigs).toContain('export function foo(a: string): void')
    expect(sigs).toContain('class Bar')
    expect(sigs).toContain('export const baz = 1')
    // no trailing "{" left on captured lines
    expect(sigs.every((s) => !s.endsWith('{'))).toBe(true)
  })

  it('extracts Python def/class', () => {
    const sigs = fileSignatures('m.py', 'def run(x):\n    pass\nclass Thing:\n    pass\n')
    expect(sigs).toContain('def run(x):')
    expect(sigs).toContain('class Thing:')
  })

  it('returns [] for unrecognized extensions', () => {
    expect(fileSignatures('notes.txt', 'function foo() {}')).toEqual([])
  })

  it('dedupes repeated identical signatures', () => {
    const src = 'def f():\n    pass\ndef f():\n    pass\n'
    expect(fileSignatures('x.py', src)).toEqual(['def f():'])
  })

  it('skips absurdly long (minified) lines', () => {
    const long = 'function f(){' + 'a'.repeat(500) + '}'
    expect(fileSignatures('x.js', long)).toEqual([])
  })
})
