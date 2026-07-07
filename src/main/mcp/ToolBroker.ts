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
  dangerous: boolean
  resolve: (output: string) => void
}

export class ToolBroker {
  private pending = new Map<string, Pending>()
  private seq = 0

  propose(tool: string, args: Record<string, unknown>): Promise<string> {
    const id = `tool_${++this.seq}`
    // Screen interactive calls too: a dangerous argument forces the explicit
    // confirm path — trusted-tool auto-approve must not skip the human.
    const danger = checkDangerous(JSON.stringify(args))
    const msg: PendingTool = {
      id,
      tool,
      argsPreview: JSON.stringify(args, null, 2),
      dangerous: danger.dangerous,
      dangerReason: danger.dangerous ? danger.reason : undefined
    }
    appState.send(CH.toolPending, msg)
    return new Promise((resolve) => this.pending.set(id, { tool, args, dangerous: danger.dangerous, resolve }))
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
    // Defense in depth (mirrors CommandBroker.approve): the plain approve path —
    // which trusted-tool auto-approve can hit without a human — never executes a
    // dangerous call. Those require the explicit confirmDangerous() the warning
    // card invokes, so main stays authoritative even against a buggy renderer.
    if (p.dangerous) {
      this.pending.delete(id)
      console.warn(`[security] approve() blocked dangerous MCP call ${p.tool} (needs explicit confirm)`)
      appState.send(CH.toolResult, { id, tool: p.tool, output: '[blocked: dangerous argument needs explicit confirmation]' })
      p.resolve(`[blocked: dangerous MCP argument needs explicit confirmation]`)
      return
    }
    this.pending.delete(id)
    p.resolve(await this.exec(id, p.tool, p.args))
  }

  /** Explicit run of a dangerous MCP call — only the human warning card invokes this. */
  async confirmDangerous(id: string): Promise<void> {
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
