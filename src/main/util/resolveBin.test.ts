import { describe, it, expect, afterEach } from 'vitest'
import { cleanClaudeEnv, findBin } from './resolveBin'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
})

describe('cleanClaudeEnv', () => {
  it('strips nesting markers and ANTHROPIC_* auth vars', () => {
    process.env.CLAUDECODE = '1'
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
    process.env.ANTHROPIC_BASE_URL = 'http://proxy'
    process.env.ANTHROPIC_API_KEY = 'sk-x'
    process.env.ANTHROPIC_AUTH_TOKEN = 't'
    process.env.ANTHROPIC_MODEL = 'm'
    const env = cleanClaudeEnv()
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBeUndefined()
  })

  it('preserves unrelated environment variables', () => {
    process.env.PATH = '/usr/bin'
    process.env.MY_CUSTOM_VAR = 'keep'
    const env = cleanClaudeEnv()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.MY_CUSTOM_VAR).toBe('keep')
  })

  it('keeps unrelated ANTHROPIC-prefixed-but-not-listed vars only if exact-listed', () => {
    // CLAUDE_CODE* prefix is stripped; a different CLAUDE var is kept.
    process.env.CLAUDE_CONFIG_DIR = 'keep-me'
    process.env.CLAUDE_CODE_SECRET = 'drop-me'
    const env = cleanClaudeEnv()
    expect(env.CLAUDE_CONFIG_DIR).toBe('keep-me')
    expect(env.CLAUDE_CODE_SECRET).toBeUndefined()
  })
})

describe('findBin', () => {
  it('returns null for an explicit path that does not exist', () => {
    expect(findBin('/nonexistent/path/to/binary-xyz')).toBeNull()
  })

  it('returns null for an unknown bare command name', () => {
    expect(findBin('definitely-not-a-real-cmd-zzz')).toBeNull()
  })
})
