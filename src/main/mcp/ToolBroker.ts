import { appState } from '../state'
import { CH, type PendingTool } from '../../shared/types'
import { mcpManager } from './MCPClientManager'

// Default-deny gate for MCP tool calls (parallel to CommandBroker). The model's
// proposed call is surfaced for approval; on approve we invoke the MCP server.
interface Pending {
  tool: string
  args: Record<string, unknown>
  resolve: (output: string) => void
}

export class ToolBroker {
  private pending = new Map<string, Pending>()
  private seq = 0

  propose(tool: string, args: Record<string, unknown>): Promise<string> {
    const id = `tool_${++this.seq}`
    const msg: PendingTool = { id, tool, argsPreview: JSON.stringify(args, null, 2) }
    appState.send(CH.toolPending, msg)
    return new Promise((resolve) => this.pending.set(id, { tool, args, resolve }))
  }

  async approve(id: string): Promise<void> {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    const output = await mcpManager.call(p.tool, p.args)
    appState.send(CH.toolResult, { id, tool: p.tool, output })
    p.resolve(output)
  }

  reject(id: string): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    appState.send(CH.toolResult, { id, tool: p.tool, output: '[rejected by user]' })
    p.resolve(`[tool ${p.tool} rejected by user]`)
  }
}

export const toolBroker = new ToolBroker()
