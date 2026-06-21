import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'

const TMP = vi.hoisted(() => require('path').join(require('os').tmpdir(), `prov-test-${process.pid}`))

vi.mock('electron', () => ({ app: { getPath: () => TMP } }))

// In-memory keychain stub.
const store = vi.hoisted(() => ({ map: new Map<string, string>(), native: null as string | null }))
vi.mock('../keychain/KeychainManager', () => ({
  KeychainManager: {
    get: async (acct: string) => store.map.get(acct) ?? null,
    has: async (acct: string) => store.map.has(acct),
    set: async (acct: string, key: string) => void store.map.set(acct, key),
    getKey: async () => store.native // native Gemini key
  }
}))

import { listProviders, getKey } from './providers'

const cfg = join(TMP, 'api_providers.json')

beforeEach(async () => {
  await fs.mkdir(TMP, { recursive: true })
  await fs.writeFile(cfg, JSON.stringify({ providers: {} }), 'utf-8')
  store.map.clear()
  store.native = null
})
afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})

describe('listProviders', () => {
  it('includes built-ins with their model suggestion lists', async () => {
    const list = await listProviders()
    const byId = Object.fromEntries(list.map((p) => [p.id, p]))
    expect(byId.openai).toBeTruthy()
    expect(byId.google.models).toContain('gemini-2.5-flash')
    expect(byId.ollama.noKey).toBe(true)
  })

  it('hasKey is true for noKey providers and reflects the keychain otherwise', async () => {
    store.map.set('api:openai', 'sk-x')
    const list = await listProviders()
    const byId = Object.fromEntries(list.map((p) => [p.id, p]))
    expect(byId.ollama.hasKey).toBe(true) // noKey
    expect(byId.openai.hasKey).toBe(true) // key present
    expect(byId.mistral.hasKey).toBe(false) // no key
  })

  it('merges user overrides over a built-in', async () => {
    await fs.writeFile(cfg, JSON.stringify({ providers: { openai: { defaultModel: 'gpt-4o' } } }), 'utf-8')
    const openai = (await listProviders()).find((p) => p.id === 'openai')!
    expect(openai.defaultModel).toBe('gpt-4o')
    expect(openai.builtin).toBe(true)
  })
})

describe('getKey google fallback', () => {
  it('uses the dedicated api:google key when present', async () => {
    store.map.set('api:google', 'dedicated')
    store.native = 'native'
    expect(await getKey('google')).toBe('dedicated')
  })

  it('falls back to the native Gemini key when no dedicated key is set', async () => {
    store.native = 'native-gemini'
    expect(await getKey('google')).toBe('native-gemini')
  })

  it('does not apply the fallback to other providers', async () => {
    store.native = 'native-gemini'
    expect(await getKey('openai')).toBeNull()
  })

  it('reports hasKey via the native fallback for google', async () => {
    store.native = 'native-gemini'
    const google = (await listProviders()).find((p) => p.id === 'google')!
    expect(google.hasKey).toBe(true)
  })
})
