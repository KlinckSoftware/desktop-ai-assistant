import { describe, it, expect } from 'vitest'
import { sanitizeId, branchName, worktreePath, WORKTREE_DIR } from './WorktreeManager'
import { parseWorktreeList } from '../fs/git'

describe('sanitizeId', () => {
  it('keeps safe chars', () => {
    expect(sanitizeId('agent_1.2-3')).toBe('agent_1.2-3')
  })
  it('replaces unsafe chars with dashes', () => {
    expect(sanitizeId('a/b c:d')).toBe('a-b-c-d')
  })
  it('trims leading/trailing dashes', () => {
    expect(sanitizeId('///x///')).toBe('x')
  })
  it('falls back to "session" when empty after sanitizing', () => {
    expect(sanitizeId('///')).toBe('session')
  })
})

describe('branchName', () => {
  it('prefixes agent sessions', () => {
    expect(branchName('agent', 'abc')).toBe('agent/abc')
  })
  it('prefixes pipeline runs', () => {
    expect(branchName('pipeline', 'run 1')).toBe('pipeline/run-1')
  })
})

describe('worktreePath', () => {
  it('nests under the repo .dai-trees dir with a kind prefix', () => {
    const p = worktreePath('/repo', 'agent', 'xy')
    expect(p.replace(/\\/g, '/')).toBe(`/repo/${WORKTREE_DIR}/agent-xy`)
  })
})

describe('parseWorktreeList', () => {
  it('parses porcelain output into path+branch entries', () => {
    const out = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.dai-trees/agent-x',
      'HEAD def456',
      'branch refs/heads/agent/x',
      ''
    ].join('\n')
    const entries = parseWorktreeList(out)
    expect(entries).toEqual([
      { path: '/repo', branch: 'main' },
      { path: '/repo/.dai-trees/agent-x', branch: 'agent/x' }
    ])
  })
  it('handles a detached worktree (no branch line)', () => {
    const out = ['worktree /repo', 'HEAD abc123', 'detached', ''].join('\n')
    expect(parseWorktreeList(out)).toEqual([{ path: '/repo', branch: '' }])
  })
  it('returns empty for empty input', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
})
