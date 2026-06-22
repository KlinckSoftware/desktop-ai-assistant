import { describe, it, expect } from 'vitest'
import { isProtectedPath, isSecretPath } from './protectedPath'

describe('isProtectedPath', () => {
  it('blocks .git anywhere in the path', () => {
    expect(isProtectedPath('.git/hooks/pre-commit')).toBe(true)
    expect(isProtectedPath('.git/config')).toBe(true)
    expect(isProtectedPath('.dai-trees/agent-x/.git/hooks/post-merge')).toBe(true)
  })
  it('blocks node_modules', () => {
    expect(isProtectedPath('node_modules/evil/index.js')).toBe(true)
  })
  it('handles backslash paths', () => {
    expect(isProtectedPath('.git\\hooks\\pre-commit')).toBe(true)
  })
  it('allows normal source paths and lookalikes', () => {
    expect(isProtectedPath('src/main/index.ts')).toBe(false)
    expect(isProtectedPath('gitignore')).toBe(false)
    expect(isProtectedPath('docs/git/notes.md')).toBe(false) // segment is "git", not ".git"
  })
})

describe('isSecretPath', () => {
  it('flags dotenv variants', () => {
    expect(isSecretPath('.env')).toBe(true)
    expect(isSecretPath('config/.env.production')).toBe(true)
  })
  it('flags keys and credentials', () => {
    expect(isSecretPath('certs/server.pem')).toBe(true)
    expect(isSecretPath('id_rsa')).toBe(true)
    expect(isSecretPath('app.key')).toBe(true)
    expect(isSecretPath('credentials')).toBe(true)
    expect(isSecretPath('my_secret.txt')).toBe(true)
  })
  it('flags files inside secret dirs', () => {
    expect(isSecretPath('.ssh/known_hosts')).toBe(true)
    expect(isSecretPath('.aws/config')).toBe(true)
  })
  it('does not flag ordinary files', () => {
    expect(isSecretPath('src/index.ts')).toBe(false)
    expect(isSecretPath('README.md')).toBe(false)
    expect(isSecretPath('keyboard.ts')).toBe(false)
  })
})
