import { appState } from './state'
import { costFor } from '../shared/pricing'

// Main-side session spend tracker — the AUTHORITY for the cost cap. The renderer
// cap is fast UX feedback, but only main can stop unattended (scheduled/pipeline)
// runs, so the ceiling is enforced here too. Estimated from provider-reported
// usage via the shared price table (same table the renderer shows).

let sessionCost = 0

/** Add the estimated USD cost of one request to the running session total. */
export function addUsageCost(model: string | undefined, promptTokens: number, completionTokens: number): void {
  const c = costFor(model, promptTokens, completionTokens)
  if (c) sessionCost += c
}

export function sessionSpend(): number {
  return sessionCost
}

/** True when a cap is set (>0) and the session has reached it. */
export function capReached(): boolean {
  const cap = appState.settings.costCap
  return cap > 0 && sessionCost >= cap
}

export function resetBudget(): void {
  sessionCost = 0
}
