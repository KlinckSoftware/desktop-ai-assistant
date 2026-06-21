import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

// Fetches LiteLLM's community-maintained price table and reduces it to the
// {model -> per-1M USD in/out} shape our cost meter uses. Keyed by the BARE
// model name (provider prefix stripped) so it lines up with the substring match
// in shared/pricing. Best-effort: falls back to the last cached copy offline.

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

interface Rate {
  in: number
  out: number
}

function cachePath(): string {
  return join(app.getPath('userData'), 'pricing_cache.json')
}

function transform(raw: Record<string, unknown>): Record<string, Rate> {
  const out: Record<string, Rate> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue
    const v = val as { input_cost_per_token?: number; output_cost_per_token?: number }
    if (typeof v.input_cost_per_token !== 'number' || typeof v.output_cost_per_token !== 'number') continue
    const bare = key.split('/').pop() ?? key
    // per-token -> per-1M tokens
    out[bare] = { in: v.input_cost_per_token * 1_000_000, out: v.output_cost_per_token * 1_000_000 }
  }
  return out
}

export async function fetchLivePricing(): Promise<Record<string, Rate>> {
  try {
    const res = await fetch(LITELLM_URL)
    if (!res.ok) throw new Error(`status ${res.status}`)
    const raw = (await res.json()) as Record<string, unknown>
    const table = transform(raw)
    if (Object.keys(table).length === 0) throw new Error('empty table')
    await fs.writeFile(cachePath(), JSON.stringify(table), 'utf-8').catch(() => {})
    return table
  } catch {
    // Offline / fetch failed — serve the last cached copy if present.
    try {
      return JSON.parse(await fs.readFile(cachePath(), 'utf-8')) as Record<string, Rate>
    } catch {
      return {}
    }
  }
}
