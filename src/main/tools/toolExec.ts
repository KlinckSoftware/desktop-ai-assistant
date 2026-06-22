import { toolBroker } from '../mcp/ToolBroker'
import { mcpManager } from '../mcp/MCPClientManager'
import { appState } from '../state'
import { resolve } from 'path'
import { gitDiff } from '../fs/git'
import { buildRepoMap } from '../fs/repoMap'
import { isSecretPath } from '../../shared/protectedPath'
import type { ApprovalPolicy } from '../policy/ApprovalPolicy'
import type { CommandBroker } from '../executor/CommandBroker'
import type { FileEditBroker } from '../editor/FileEditBroker'
import type { FileSystemManager } from '../fs/FileSystemManager'

// Shared tool surface for the agentic API chats. Three tiers:
//  - read-only (read_file, list_dir, search_code, git_diff): auto-execute, no
//    approval prompt — they can't mutate anything and are confined to the root.
//  - apply_edit: surgical find/replace, routed through edit-review approval.
//  - run_command / write_file / MCP tools: gated through their approval brokers.
// Provider clients format these specs into their own tool-declaration shape.

let broker: CommandBroker | null = null
let editBroker: FileEditBroker | null = null
let fsm: FileSystemManager | null = null
export function setBrokers(b: CommandBroker, e: FileEditBroker, f: FileSystemManager): void {
  broker = b
  editBroker = e
  fsm = f
}

// Gemini/OpenAI both accept an OpenAPI-subset JSON schema; strip keys they reject.
const ALLOWED = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'nullable'])
export function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (!ALLOWED.has(k)) continue
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Record<string, unknown> = {}
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = sanitizeSchema(pv)
      out.properties = props
    } else if (k === 'items') out.items = sanitizeSchema(v)
    else out[k] = v
  }
  if (!out.type) out.type = 'object'
  return out
}

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

const str = (d: string): Record<string, unknown> => ({ type: 'string', description: d })

export function toolSpecs(): ToolSpec[] {
  const specs: ToolSpec[] = [
    {
      name: 'read_file',
      description: 'Read a text file in the project. Returns its full contents. No approval needed.',
      parameters: {
        type: 'object',
        properties: { path: str('Path relative to the project root.') },
        required: ['path']
      }
    },
    {
      name: 'list_dir',
      description: 'List all file paths in the project (relative, forward-slash). No approval needed.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'repo_map',
      description:
        'Get a compact outline of the whole project: each source file with its top-level declarations (functions, classes, types). Call this first to orient before reading files. No approval needed.',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'search_code',
      description: 'Plain-text search across project files. Returns matching `path:line: text`. No approval needed.',
      parameters: {
        type: 'object',
        properties: { query: str('Substring to search for (case-insensitive).') },
        required: ['query']
      }
    },
    {
      name: 'git_diff',
      description: 'Show uncommitted working-tree changes (optionally for one file). No approval needed.',
      parameters: {
        type: 'object',
        properties: { path: str('Optional path (relative to root) to diff a single file.') }
      }
    },
    {
      name: 'apply_edit',
      description:
        'Make a surgical edit by replacing the first exact occurrence of `find` with `replace` in a file (requires approval). Prefer this over write_file for small changes.',
      parameters: {
        type: 'object',
        properties: {
          path: str('Path relative to the project root.'),
          find: str('Exact text to find (must appear verbatim).'),
          replace: str('Replacement text.')
        },
        required: ['path', 'find', 'replace']
      }
    },
    {
      name: 'run_command',
      description: 'Run a shell command on the user machine (requires approval). Returns its output.',
      parameters: {
        type: 'object',
        properties: { command: str('The shell command to run.') },
        required: ['command']
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with full new contents (requires approval).',
      parameters: {
        type: 'object',
        properties: {
          path: str('Path relative to the project root.'),
          content: str('Entire new file contents.')
        },
        required: ['path', 'content']
      }
    }
  ]
  for (const t of mcpManager.tools()) {
    specs.push({
      name: t.qualified,
      description: t.description || `MCP tool ${t.name} on ${t.server}`,
      parameters: sanitizeSchema(t.inputSchema)
    })
  }
  return specs
}

// Resolve an agent-supplied path against the SESSION's root — its isolated
// worktree when it has one, else the shared project root. Worktrees live inside
// the project root, so FileSystemManager.readFile/writeFile's root confinement
// (assertInRoot) still holds.
function abs(root: string, p: string): string {
  return resolve(root, p)
}

export async function execTool(
  name: string,
  args: Record<string, unknown>,
  origin: 'api' | 'gemini' = 'api',
  sessionId: string = origin,
  policy?: ApprovalPolicy
): Promise<string> {
  const root = appState.rootFor(sessionId)
  // Gated mutating tools: with a policy (autonomous/dry-run pipeline) they route
  // through the brokers' policy path; without one (interactive chat) they use the
  // human approval card as before. Read-only tools always run (no side effects).
  try {
    switch (name) {
      // --- read-only, auto-execute ---
      case 'read_file': {
        if (!fsm) return '[no fs]'
        const rel = String(args.path ?? '')
        // Don't ship secret-looking files (.env, keys, .ssh) to the model unless
        // the user explicitly allows it. The editor UI path is unaffected.
        if (!appState.settings.allowSecretReads && isSecretPath(rel)) {
          return `[blocked: "${rel}" looks like a secret — enable "allow secret reads" in Settings to override]`
        }
        const content = await fsm.readFile(abs(root, rel))
        return content.length > 60000 ? content.slice(0, 60000) + '\n[…truncated]' : content
      }
      case 'list_dir': {
        if (!fsm) return '[no fs]'
        return (await fsm.listFiles(root)).join('\n') || '[empty]'
      }
      case 'repo_map': {
        if (!fsm) return '[no fs]'
        return buildRepoMap(fsm, root)
      }
      case 'search_code': {
        if (!fsm) return '[no fs]'
        let hits = await fsm.search(root, String(args.query ?? ''))
        // Drop hits from secret files so a search can't exfiltrate their contents.
        if (!appState.settings.allowSecretReads) hits = hits.filter((h) => !isSecretPath(h.split(':')[0]))
        return hits.length ? hits.join('\n') : '[no matches]'
      }
      case 'git_diff': {
        const d = await gitDiff(root, args.path ? String(args.path) : undefined)
        return d || '[no changes]'
      }
      // --- gated ---
      case 'apply_edit': {
        if (!fsm || !editBroker) return '[no editor]'
        const path = String(args.path ?? '')
        const find = String(args.find ?? '')
        const replace = String(args.replace ?? '')
        const current = await fsm.readFile(abs(root, path))
        const i = current.indexOf(find)
        if (i < 0) return `[apply_edit: text not found in ${path}]`
        const next = current.slice(0, i) + replace + current.slice(i + find.length)
        return policy
          ? editBroker.runWithPolicy(path, next, origin, 'apply_edit', policy, root)
          : editBroker.propose(path, next, origin, root)
      }
      case 'run_command': {
        if (!broker) return '[no executor]'
        const cmd = String(args.command ?? '')
        return policy ? broker.runWithPolicy(cmd, origin, sessionId, policy) : broker.propose(cmd, origin, sessionId)
      }
      case 'write_file': {
        if (!editBroker) return '[no editor]'
        const path = String(args.path ?? '')
        const content = String(args.content ?? '')
        return policy
          ? editBroker.runWithPolicy(path, content, origin, 'write_file', policy, root)
          : editBroker.propose(path, content, origin, root)
      }
      default:
        return policy ? toolBroker.runWithPolicy(name, args, policy) : toolBroker.propose(name, args)
    }
  } catch (err) {
    return `[tool ${name} failed: ${err instanceof Error ? err.message : String(err)}]`
  }
}
