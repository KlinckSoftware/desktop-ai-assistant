import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

// MCP client: reads a Claude-Desktop-style config, spawns each server over
// stdio, discovers its tools, and proxies tool calls. Best-effort — a server
// that fails to start is reported in status, not fatal.

interface ServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface DiscoveredTool {
  server: string
  name: string // bare tool name on the server
  qualified: string // `${server}__${name}` — what we expose to the model
  description: string
  inputSchema: Record<string, unknown>
}

export interface ServerStatus {
  server: string
  connected: boolean
  toolCount: number
  error?: string
}

class MCPClientManager {
  private clients = new Map<string, Client>()
  private discovered: DiscoveredTool[] = []
  private status: ServerStatus[] = []

  configPath(): string {
    return join(app.getPath('userData'), 'mcp_servers.json')
  }

  /** Ensure a config file exists so the user has something to edit. */
  async ensureConfig(): Promise<void> {
    try {
      await fs.access(this.configPath())
    } catch {
      await fs.writeFile(this.configPath(), JSON.stringify({ mcpServers: {} }, null, 2), 'utf-8')
    }
  }

  private async readConfig(): Promise<Record<string, ServerConfig>> {
    try {
      const json = JSON.parse(await fs.readFile(this.configPath(), 'utf-8'))
      return (json.mcpServers ?? {}) as Record<string, ServerConfig>
    } catch {
      return {}
    }
  }

  async init(): Promise<void> {
    await this.ensureConfig()
    await this.connectAll()
  }

  async connectAll(): Promise<ServerStatus[]> {
    await this.disconnectAll()
    const servers = await this.readConfig()
    for (const [name, cfg] of Object.entries(servers)) {
      try {
        const env: Record<string, string> = {}
        for (const [k, v] of Object.entries(process.env)) if (v != null) env[k] = v
        for (const [k, v] of Object.entries(cfg.env ?? {})) env[k] = v

        const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env })
        const client = new Client({ name: 'desktop-ai-assistant', version: '1.0.0' }, { capabilities: {} })
        await client.connect(transport)
        const { tools } = await client.listTools()
        this.clients.set(name, client)
        for (const t of tools) {
          this.discovered.push({
            server: name,
            name: t.name,
            qualified: `${name}__${t.name}`,
            description: t.description ?? '',
            inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} }
          })
        }
        this.status.push({ server: name, connected: true, toolCount: tools.length })
      } catch (err) {
        this.status.push({
          server: name,
          connected: false,
          toolCount: 0,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return this.status
  }

  tools(): DiscoveredTool[] {
    return this.discovered
  }

  statusList(): ServerStatus[] {
    return this.status
  }

  /** Call a tool by its qualified `server__tool` name. Returns text output. */
  async call(qualified: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.discovered.find((t) => t.qualified === qualified)
    if (!tool) return `[mcp: unknown tool ${qualified}]`
    const client = this.clients.get(tool.server)
    if (!client) return `[mcp: server ${tool.server} not connected]`
    try {
      const res = await client.callTool({ name: tool.name, arguments: args })
      const content = (res.content as { type: string; text?: string }[]) ?? []
      const text = content.map((p) => (p.type === 'text' ? p.text : JSON.stringify(p))).join('\n')
      return text || '[no output]'
    } catch (err) {
      return `[mcp error: ${err instanceof Error ? err.message : String(err)}]`
    }
  }

  async disconnectAll(): Promise<void> {
    for (const c of this.clients.values()) {
      try {
        await c.close()
      } catch {
        /* ignore */
      }
    }
    this.clients.clear()
    this.discovered = []
    this.status = []
  }
}

export const mcpManager = new MCPClientManager()
