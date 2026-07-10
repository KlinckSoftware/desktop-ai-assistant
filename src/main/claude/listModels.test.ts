import { describe, it, expect } from 'vitest'
import { CLAUDE_MODELS, CLAUDE_EFFORT } from '../../shared/claudeModels'
import { listClaudeModels } from './listModels'

// The claude CLI has no model-enumeration subcommand, so listClaudeModels()
// always serves the shared hardcoded list (fallback path is the only path
// today). This locks in that contract and that it's sourced from the single
// shared const module, not a locally duplicated list.
describe('listClaudeModels', () => {
  it('resolves the shared CLAUDE_MODELS / CLAUDE_EFFORT lists', async () => {
    const result = await listClaudeModels()
    expect(result.models).toEqual(CLAUDE_MODELS)
    expect(result.effort).toEqual(CLAUDE_EFFORT)
  })

  it('includes the CLI-default and tier-alias entries', async () => {
    const { models } = await listClaudeModels()
    const values = models.map((m) => m.value)
    expect(values).toContain('') // CLI default
    expect(values).toContain('sonnet')
    expect(values).toContain('opus')
    expect(values).toContain('haiku')
    expect(values).toContain('claude-sonnet-4-5')
  })

  it('returns a stable/cached result across repeated calls', async () => {
    const a = await listClaudeModels()
    const b = await listClaudeModels()
    expect(a).toBe(b)
  })
})
