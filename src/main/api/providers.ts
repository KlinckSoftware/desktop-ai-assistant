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
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o4-mini', 'o3-mini'],
    docsUrl: 'https://platform.openai.com/api-keys',
    builtin: true
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    // Google's OpenAI-compatible surface — lets Gemini run through the unified
    // API path (persistence, tools, fleet, cost, debate). The native Gemini
    // panel still exists for multimodal image input.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    docsUrl: 'https://aistudio.google.com/apikey',
    builtin: true
  },
  groq: {
    id: 'groq',
    name: 'Groq (free)',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    docsUrl: 'https://console.groq.com/keys',
    builtin: true
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    docsUrl: 'https://console.mistral.ai/api-keys',
    builtin: true
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    models: ['openrouter/auto', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini', 'google/gemini-2.0-flash-exp'],
    docsUrl: 'https://openrouter.ai/keys',
    builtin: true
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    models: ['llama3.2', 'llama3.1', 'qwen2.5-coder', 'deepseek-r1'],
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
      models: def.models ?? base?.models,
      docsUrl: def.docsUrl ?? base?.docsUrl,
      noKey: def.noKey ?? base?.noKey,
      builtin: base?.builtin ?? false
    }
  }
  return Promise.all(
    Object.values(merged).map(async (p) => ({ ...p, hasKey: p.noKey ? true : (await getKey(p.id)) != null }))
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
    ...(p.models ? { models: p.models } : {}),
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

export async function getKey(id: string): Promise<string | null> {
  const key = await KeychainManager.get(keyAccount(id))
  // The Google provider reuses the native Gemini key if no dedicated one is set,
  // so users who already added a Gemini key don't have to enter it again.
  if (!key && id === 'google') return KeychainManager.getKey()
  return key
}
export function saveKey(id: string, key: string): Promise<void> {
  return KeychainManager.set(keyAccount(id), key.trim())
}
