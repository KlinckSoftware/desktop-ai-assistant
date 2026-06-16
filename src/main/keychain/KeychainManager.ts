// Secure storage for the Gemini API key via the OS keychain.
// Falls back to a no-op warning if keytar fails to load (e.g. native build issue),
// so the app still launches — the user just can't persist a key.

const SERVICE = 'desktop-ai-assistant'
const ACCOUNT = 'gemini-api-key'

type Keytar = typeof import('keytar')

let keytar: Keytar | null = null
let loaded = false

async function load(): Promise<Keytar | null> {
  if (loaded) return keytar
  loaded = true
  try {
    const mod = await import('keytar')
    keytar = (mod.default ?? mod) as Keytar
  } catch (err) {
    console.warn('[keychain] keytar unavailable, key persistence disabled:', err)
    keytar = null
  }
  return keytar
}

export const KeychainManager = {
  async getKey(): Promise<string | null> {
    const k = await load()
    if (!k) return null
    return k.getPassword(SERVICE, ACCOUNT)
  },

  async setKey(key: string): Promise<void> {
    const k = await load()
    if (!k) {
      console.warn('[keychain] cannot persist key — keytar unavailable')
      return
    }
    await k.setPassword(SERVICE, ACCOUNT, key)
  },

  async hasKey(): Promise<boolean> {
    return (await this.getKey()) != null
  }
}
