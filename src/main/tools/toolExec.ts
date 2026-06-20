import { toolBroker } from '../mcp/ToolBroker'
import { mcpManager } from '../mcp/MCPClientManager'
import type { CommandBroker } from '../executor/CommandBroker'
import type { FileEditBroker } from '../editor/FileEditBroker'

// Shared tool surface for the agentic API chats: built-in run_command +
// write_file (routed through their approval gates) plus all discovered MCP
// tools (routed through the tool approval gate). Provider clients format these
// into their own tool-declaration shape.

let broker: CommandBroker | null = null
let editBroker: FileEditBroker | null = null
export function setBrokers(b: CommandBroker, e: FileEditBroker): void {
  broker = b
  editBroker = e
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

export function toolSpecs(): ToolSpec[] {
  const specs: ToolSpec[] = [
    {
      name: 'run_command',
      description: 'Run a shell command on the user machine (requires approval). Returns its output.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The shell command to run.' } },
        required: ['command']
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with full new contents (requires approval).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the project root.' },
          content: { type: 'string', description: 'Entire new file contents.' }
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

export async function execTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'run_command') {
    return broker ? broker.propose(String(args.command ?? ''), 'api', 'api') : '[no executor]'
  }
  if (name === 'write_file') {
    return editBroker ? editBroker.propose(String(args.path ?? ''), String(args.content ?? ''), 'api') : '[no editor]'
  }
  return toolBroker.propose(name, args)
}
