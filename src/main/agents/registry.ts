import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { AgentDef } from '../../shared/types'

// Built-in CLI agents. Any can be overridden, and new ones added, via a
// user-editable agents.json in userData (same pattern as mcp_servers.json).
const BUILTIN: Record<string, AgentDef> = {
  claude: { id: 'claude', name: 'Claude Code', command: 'claude', args: [] },
  gemini: { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: [] },
  aider: { id: 'aider', name: 'Aider', command: 'aider', args: [] },
  codex: { id: 'codex', name: 'Codex', command: 'codex', args: [] }
}

function configPath(): string {
  return join(app.getPath('userData'), 'agents.json')
}

export async function ensureConfig(): Promise<void> {
  try {
    await fs.access(configPath())
  } catch {
    // Seed with an empty overrides object + a comment-free example shape.
    await fs.writeFile(configPath(), JSON.stringify({ agents: {} }, null, 2), 'utf-8')
  }
}

/** Built-in agents merged with (overridden by) the user's agents.json. */
export async function listAgents(): Promise<AgentDef[]> {
  let user: Record<string, Partial<AgentDef>> = {}
  try {
    const json = JSON.parse(await fs.readFile(configPath(), 'utf-8'))
    user = (json.agents ?? {}) as Record<string, Partial<AgentDef>>
  } catch {
    /* no/invalid config — built-ins only */
  }
  const merged: Record<string, AgentDef> = { ...BUILTIN }
  for (const [id, def] of Object.entries(user)) {
    merged[id] = {
      id,
      name: def.name ?? merged[id]?.name ?? id,
      command: def.command ?? merged[id]?.command ?? id,
      args: def.args ?? merged[id]?.args ?? [],
      env: def.env ?? merged[id]?.env
    }
  }
  return Object.values(merged)
}

export async function getAgent(id: string): Promise<AgentDef | null> {
  return (await listAgents()).find((a) => a.id === id) ?? null
}
