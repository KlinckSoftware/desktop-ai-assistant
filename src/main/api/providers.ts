import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { KeychainManager } from '../keychain/KeychainManager'
import type { ApiProvider } from '../../shared/types'

// Built-in OpenAI-compatible API providers. Override/extend via api_providers.json.
const BUILTIN: Record<string, ApiProvider> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/api-keys',
    builtin: true
  },
  groq: {
    id: 'groq',
    name: 'Groq (free)',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/keys',
    builtin: true
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    docsUrl: 'https://console.mistral.ai/api-keys',
    builtin: true
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    docsUrl: 'https://openrouter.ai/keys',
    builtin: true
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    docsUrl: 'https://ollama.com',
    noKey: true,
    builtin: true
  }
}

const keyAccount = (id: string): string => `api:${id}`

function configPath(): string {
  return join(app.getPath('userData'), 'api_providers.json')
}

export async function ensureConfig(): Promise<void> {
  try {
    await fs.access(configPath())
  } catch {
    await fs.writeFile(configPath(), JSON.stringify({ providers: {} }, null, 2), 'utf-8')
  }
}

async function readUser(): Promise<Record<string, Partial<ApiProvider>>> {
  try {
    const json = JSON.parse(await fs.readFile(configPath(), 'utf-8'))
    return (json.providers ?? {}) as Record<string, Partial<ApiProvider>>
  } catch {
    return {}
  }
}
async function writeUser(p: Record<string, Partial<ApiProvider>>): Promise<void> {
  await fs.writeFile(configPath(), JSON.stringify({ providers: p }, null, 2), 'utf-8')
}

export async function listProviders(): Promise<ApiProvider[]> {
  const user = await readUser()
  const merged: Record<string, ApiProvider> = {}
  for (const [id, def] of Object.entries(BUILTIN)) merged[id] = { ...def }
  for (const [id, def] of Object.entries(user)) {
    const base = merged[id]
    merged[id] = {
      id,
      name: def.name ?? base?.name ?? id,
      baseUrl: def.baseUrl ?? base?.baseUrl ?? '',
      defaultModel: def.defaultModel ?? base?.defaultModel ?? '',
      docsUrl: def.docsUrl ?? base?.docsUrl,
      noKey: def.noKey ?? base?.noKey,
      builtin: base?.builtin ?? false
    }
  }
  return Promise.all(
    Object.values(merged).map(async (p) => ({ ...p, hasKey: p.noKey ? true : await KeychainManager.has(keyAccount(p.id)) }))
  )
}

export async function getProvider(id: string): Promise<ApiProvider | null> {
  return (await listProviders()).find((p) => p.id === id) ?? null
}

export async function saveProvider(p: ApiProvider): Promise<ApiProvider[]> {
  const user = await readUser()
  user[p.id] = {
    name: p.name,
    baseUrl: p.baseUrl,
    defaultModel: p.defaultModel,
    ...(p.docsUrl ? { docsUrl: p.docsUrl } : {}),
    ...(p.noKey ? { noKey: true } : {})
  }
  await writeUser(user)
  return listProviders()
}

export async function removeProvider(id: string): Promise<ApiProvider[]> {
  const user = await readUser()
  delete user[id]
  await writeUser(user)
  return listProviders()
}

export function getKey(id: string): Promise<string | null> {
  return KeychainManager.get(keyAccount(id))
}
export function saveKey(id: string, key: string): Promise<void> {
  return KeychainManager.set(keyAccount(id), key.trim())
}
