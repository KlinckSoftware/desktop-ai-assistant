import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { findBin } from '../util/resolveBin'
import type { AgentDef } from '../../shared/types'

// Built-in CLI agents. Any can be overridden, and new ones added, via a
// user-editable agents.json in userData (same pattern as mcp_servers.json).
const BUILTIN: Record<string, AgentDef> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: [],
    builtin: true,
    docsUrl: 'https://docs.claude.com/en/docs/claude-code',
    installHint: 'Install Claude Code, then run `claude` once to log in.'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    builtin: true,
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    installHint: 'npm i -g @google/gemini-cli, then run `gemini` to authenticate.'
  },
  aider: {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    args: [],
    builtin: true,
    docsUrl: 'https://aider.chat',
    installHint: 'python -m pip install aider-install && aider-install (or pipx install aider-chat).'
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    args: [],
    builtin: true,
    docsUrl: 'https://github.com/openai/codex',
    installHint: 'npm i -g @openai/codex, then run `codex` to sign in.'
  }
}

function configPath(): string {
  return join(app.getPath('userData'), 'agents.json')
}

export async function ensureConfig(): Promise<void> {
  try {
    await fs.access(configPath())
  } catch {
    await fs.writeFile(configPath(), JSON.stringify({ agents: {} }, null, 2), 'utf-8')
  }
}

async function readUser(): Promise<Record<string, Partial<AgentDef>>> {
  try {
    const json = JSON.parse(await fs.readFile(configPath(), 'utf-8'))
    return (json.agents ?? {}) as Record<string, Partial<AgentDef>>
  } catch {
    return {}
  }
}

async function writeUser(agents: Record<string, Partial<AgentDef>>): Promise<void> {
  await fs.writeFile(configPath(), JSON.stringify({ agents }, null, 2), 'utf-8')
}

/** Built-ins merged with user overrides; `available` reflects PATH resolution. */
export async function listAgents(): Promise<AgentDef[]> {
  const user = await readUser()
  const merged: Record<string, AgentDef> = {}
  for (const [id, def] of Object.entries(BUILTIN)) merged[id] = { ...def }
  for (const [id, def] of Object.entries(user)) {
    const base = merged[id]
    merged[id] = {
      id,
      name: def.name ?? base?.name ?? id,
      command: def.command ?? base?.command ?? id,
      args: def.args ?? base?.args ?? [],
      env: def.env ?? base?.env,
      installHint: def.installHint ?? base?.installHint,
      docsUrl: def.docsUrl ?? base?.docsUrl,
      builtin: base?.builtin ?? false
    }
  }
  return Object.values(merged).map((a) => ({ ...a, available: findBin(a.command) != null }))
}

export async function getAgent(id: string): Promise<AgentDef | null> {
  return (await listAgents()).find((a) => a.id === id) ?? null
}

/** Add or update a user agent; returns the refreshed list. */
export async function saveAgent(def: AgentDef): Promise<AgentDef[]> {
  const user = await readUser()
  user[def.id] = {
    name: def.name,
    command: def.command,
    args: def.args ?? [],
    ...(def.env ? { env: def.env } : {}),
    ...(def.installHint ? { installHint: def.installHint } : {}),
    ...(def.docsUrl ? { docsUrl: def.docsUrl } : {})
  }
  await writeUser(user)
  return listAgents()
}

/** Remove a user agent (built-ins revert to their default). */
export async function removeAgent(id: string): Promise<AgentDef[]> {
  const user = await readUser()
  delete user[id]
  await writeUser(user)
  return listAgents()
}
