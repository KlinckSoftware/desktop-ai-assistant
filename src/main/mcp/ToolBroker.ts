import { appState } from '../state'
import { CH, type PendingTool } from '../../shared/types'
import { decide, type ApprovalPolicy } from '../policy/ApprovalPolicy'
import { checkDangerous } from '../../shared/dangerousCommand'
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

  /** Call an MCP tool under an ApprovalPolicy (autonomous/dry-run pipeline path). */
  async runWithPolicy(tool: string, args: Record<string, unknown>, policy: ApprovalPolicy): Promise<string> {
    const d = decide(policy, tool)
    switch (d.action) {
      case 'interactive':
        return this.propose(tool, args)
      case 'dryrun':
        return `[dry-run] would call MCP tool ${tool}`
      case 'block':
        console.warn(`[policy] blocked MCP tool ${tool} — ${d.reason}`)
        return `[blocked by policy: ${d.reason}]`
      case 'run': {
        // MCP args aren't otherwise pattern-screened; for an UNATTENDED call,
        // refuse if the serialized arguments match the dangerous denylist (e.g. a
        // tool taking a shell/command/url arg with `rm -rf`, a remote transfer, …).
        const danger = checkDangerous(JSON.stringify(args))
        if (danger.dangerous) {
          console.warn(`[policy] blocked MCP tool ${tool} — dangerous argument (${danger.reason})`)
          return `[blocked: dangerous MCP argument (${danger.reason})]`
        }
        return this.exec(`tool_auto_${++this.seq}`, tool, args)
      }
    }
  }

  async approve(id: string): Promise<void> {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    p.resolve(await this.exec(id, p.tool, p.args))
  }

  private async exec(id: string, tool: string, args: Record<string, unknown>): Promise<string> {
    const output = await mcpManager.call(tool, args)
    appState.send(CH.toolResult, { id, tool, output })
    return output
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
