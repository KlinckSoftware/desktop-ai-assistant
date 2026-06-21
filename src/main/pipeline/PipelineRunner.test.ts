import { describe, it, expect } from 'vitest'
import { claudeAllowedTools } from './PipelineRunner'

describe('claudeAllowedTools', () => {
  it('read-only → read tools only (no Edit/Write/Bash)', () => {
    const t = claudeAllowedTools('read-only', false)
    expect(t).toEqual(['Read', 'Grep', 'Glob', 'LS'])
    expect(t).not.toContain('Edit')
    expect(t).not.toContain('Bash')
  })

  it('edit → adds Edit/Write/MultiEdit, still no Bash', () => {
    const t = claudeAllowedTools('edit', false)
    expect(t).toContain('Edit')
    expect(t).toContain('Write')
    expect(t).not.toContain('Bash')
  })

  it('full → adds Bash', () => {
    expect(claudeAllowedTools('full', false)).toContain('Bash')
  })

  it('dry-run forces read-only regardless of preset', () => {
    expect(claudeAllowedTools('full', true)).toEqual(['Read', 'Grep', 'Glob', 'LS'])
  })
})
