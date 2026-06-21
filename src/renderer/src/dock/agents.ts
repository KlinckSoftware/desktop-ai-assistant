import { getDockApi } from './dockApi'
import { useAppStore } from '../store/appStore'

let seq = 0

type Direction = 'left' | 'right' | 'above' | 'below' | 'within'

// Spawn an agent instance as its own dock panel. The pty session is created
// first so AgentPane can bind to it on mount. Assumes the agent is available
// (callers gate on availability and show the setup window otherwise).
export async function openAgent(
  agentId: string,
  opts: { cwd?: string; position?: { referencePanel: string; direction: Direction } } = {}
): Promise<void> {
  const api = getDockApi()
  if (!api) return
  const def = useAppStore.getState().agents.find((a) => a.id === agentId)
  const name = def?.name ?? agentId
  const n = api.panels.filter((p) => p.id.startsWith(`${agentId}-`)).length + 1
  const id = `${agentId}-${Date.now()}-${seq++}`

  // Prefer explicit position; else tab beside the active panel; else root.
  let position: { referencePanel: string; direction: Direction } | undefined
  if (opts.position && api.getPanel(opts.position.referencePanel)) position = opts.position
  else if (api.activePanel) position = { referencePanel: api.activePanel.id, direction: 'within' }

  try {
    await window.api.agent.newSession(id, agentId, opts.cwd)
    api.addPanel({
      id,
      component: 'agent',
      title: `${name} ${n}`,
      params: { sessionId: id, agentId },
      ...(position ? { position } : {})
    })
  } catch (e) {
    console.error('openAgent failed', e)
  }
}

/** Spawn the default agent (Claude), left of Gemini — first launch / post-restore.
 * Idempotent: no-op if an agent panel already exists (guards StrictMode double-run). */
export function openDefaultAgent(): void {
  const api = getDockApi()
  if (!api) return
  // A CLI-agent panel already present? (ids contain '-' but aren't 'api-' chats.)
  if (api.panels.some((p) => p.id.includes('-') && !p.id.startsWith('api-'))) return
  void openAgent('claude', { position: { referencePanel: 'gemini', direction: 'left' } })
}
