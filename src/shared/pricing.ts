// Static price snapshot (USD per 1M tokens) for the cost meter. Keys are matched
// as substrings of the model id (longest match wins), so "gpt-4o-mini-2024..."
// resolves to "gpt-4o-mini". Prices DRIFT — this is a convenience estimate, not
// billing truth. For always-current data, swap this for LiteLLM's
// model_prices_and_context_window.json. Unknown model → null (tokens only).

interface Rate {
  in: number // $ per 1M input/prompt tokens
  out: number // $ per 1M output/completion tokens
}

// Ordered loosely; lookup picks the LONGEST matching key so specific beats generic.
const PRICES: Record<string, Rate> = {
  // OpenAI
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1-nano': { in: 0.1, out: 0.4 },
  'gpt-4.1': { in: 2, out: 8 },
  'o4-mini': { in: 1.1, out: 4.4 },
  'o3-mini': { in: 1.1, out: 4.4 },
  // Groq (Llama) — approximate
  'llama-3.3-70b': { in: 0.59, out: 0.79 },
  'llama-3.1-8b': { in: 0.05, out: 0.08 },
  // Mistral
  'mistral-large': { in: 2, out: 6 },
  'mistral-small': { in: 0.2, out: 0.6 },
  // Google Gemini
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
  'gemini-1.5-pro': { in: 1.25, out: 5 }
  // Local (Ollama) and OpenRouter pass-throughs are intentionally absent → null.
}

/** USD cost for a request, or null if the model isn't in the table. */
export function costFor(model: string | undefined, promptTokens: number, completionTokens: number): number | null {
  if (!model) return null
  const m = model.toLowerCase()
  let best: Rate | null = null
  let bestLen = 0
  for (const [key, rate] of Object.entries(PRICES)) {
    if (m.includes(key) && key.length > bestLen) {
      best = rate
      bestLen = key.length
    }
  }
  if (!best) return null
  return (promptTokens * best.in + completionTokens * best.out) / 1_000_000
}
