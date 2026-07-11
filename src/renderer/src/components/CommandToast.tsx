import { useEffect, useState } from 'react'
import type { PendingCommand } from '@shared/types'
import { checkDangerous } from '@shared/dangerousCommand'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

// Approval card for a single pending command. Default-deny: if the user does
// nothing, it auto-REJECTS when the countdown hits zero (timeout 0 = never).
function Card({ cmd }: { cmd: PendingCommand }): JSX.Element {
  const remove = useAppStore((s) => s.removePending)
  const trustSession = useAppStore((s) => s.trustSession)
  const timeout = useAppStore((s) => s.approvalTimeout)
  const [left, setLeft] = useState(timeout)

  useEffect(() => {
    if (timeout <= 0) return
    const t = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(t)
  }, [timeout])

  useEffect(() => {
    if (timeout > 0 && left <= 0) reject()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, timeout])

  const danger = checkDangerous(cmd.command)

  const approve = (): void => {
    // Every call echoes back the nonce that arrived with this pending command —
    // that is what proves to main that this specific approval card (shown to a
    // human) is the one being acted on, not a forged call using a guessed id.
    // Dangerous commands take the explicit main-side confirm path; main refuses
    // to run them via plain approve(). Non-dangerous use the normal path.
    if (danger.dangerous) window.api.command.confirmDangerous(cmd.id, cmd.nonce)
    else window.api.command.approve(cmd.id, cmd.nonce)
    remove(cmd.id)
  }
  const reject = (): void => {
    window.api.command.reject(cmd.id, cmd.nonce)
    remove(cmd.id)
  }
  const trustAndApprove = (): void => {
    trustSession(cmd.sessionId)
    approve()
  }

  return (
    <div
      className={`w-96 rounded-lg border bg-panel p-3 shadow-xl ${danger.dangerous ? 'border-red-500' : 'border-border'}`}
    >
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className={cmd.origin === 'claude' ? 'text-claude' : 'text-gemini'}>
          {cmd.origin} wants to run
        </span>
        <span className="text-gray-500">{timeout > 0 ? `auto-reject in ${left}s` : 'awaiting decision'}</span>
      </div>
      {danger.dangerous && (
        <div className="mb-1 rounded bg-red-500/15 px-2 py-1 text-xs text-red-300">
          ⚠ flagged: {danger.reason} — review carefully
        </div>
      )}
      <pre className="mb-2 max-h-32 overflow-auto rounded bg-bg p-2 text-xs text-gray-200">
        {cmd.command}
      </pre>
      <div className="flex gap-2 text-xs">
        <button className="flex-1 rounded bg-green-600 py-1 font-medium text-white" onClick={approve}>
          Run
        </button>
        <button className="flex-1 rounded bg-red-600 py-1 font-medium text-white" onClick={reject}>
          Reject
        </button>
        <button
          className="rounded border border-border px-2 py-1 text-gray-300"
          onClick={trustAndApprove}
          title="Run and auto-approve future commands from this session"
        >
          Trust
        </button>
      </div>
    </div>
  )
}

// Approval card for an MCP tool call.
function ToolCard({ tool }: { tool: import('@shared/types').PendingTool }): JSX.Element {
  const remove = useAppStore((s) => s.removePendingTool)
  const trustTool = useAppStore((s) => s.trustTool)
  const timeout = useAppStore((s) => s.approvalTimeout)
  const [left, setLeft] = useState(timeout)

  useEffect(() => {
    if (timeout <= 0) return
    const t = setInterval(() => setLeft((l) => l - 1), 1000)
    return () => clearInterval(t)
  }, [timeout])
  const reject = (): void => {
    window.api.tool.reject(tool.id, tool.nonce)
    remove(tool.id)
  }
  useEffect(() => {
    if (timeout > 0 && left <= 0) reject()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, timeout])
  const approve = (): void => {
    // Echo back the nonce delivered with this pending tool call (see command
    // card above for why). Dangerous calls go through the explicit confirm
    // channel — the plain approve path is blocked for them in main.
    if (tool.dangerous) window.api.tool.confirmDangerous(tool.id, tool.nonce)
    else window.api.tool.approve(tool.id, tool.nonce)
    remove(tool.id)
  }
  const trustAndApprove = (): void => {
    trustTool(tool.tool)
    approve()
  }

  return (
    <div className={`w-96 rounded-lg border ${tool.dangerous ? 'border-red-500' : 'border-accent'} bg-panel p-3 shadow-xl`}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className={tool.dangerous ? 'text-red-400' : 'text-accent'}>MCP tool: {tool.tool}</span>
        <span className="text-gray-500">{timeout > 0 ? `auto-reject in ${left}s` : 'awaiting decision'}</span>
      </div>
      {tool.dangerous && (
        <div className="mb-1 rounded bg-red-950/60 px-2 py-1 text-xs text-red-300">
          ⚠ Dangerous argument detected{tool.dangerReason ? ` — ${tool.dangerReason}` : ''}. Review carefully.
        </div>
      )}
      <pre className="mb-2 max-h-32 overflow-auto rounded bg-bg p-2 text-xs text-gray-200">
        {tool.argsPreview}
      </pre>
      <div className="flex gap-2 text-xs">
        <button
          className={`flex-1 rounded py-1 font-medium text-white ${tool.dangerous ? 'bg-red-700' : 'bg-green-600'}`}
          onClick={approve}
        >
          {tool.dangerous ? 'Run anyway' : 'Run'}
        </button>
        <button className="flex-1 rounded bg-red-600 py-1 font-medium text-white" onClick={reject}>
          Reject
        </button>
        {!tool.dangerous && (
          <button
            className="rounded border border-border px-2 py-1 text-gray-300"
            onClick={trustAndApprove}
            title="Run and auto-approve this tool from now on"
          >
            Trust
          </button>
        )}
      </div>
    </div>
  )
}

export default function CommandToast(): JSX.Element | null {
  const pending = useAppStore((s) => s.pending)
  const pendingTools = useAppStore((s) => s.pendingTools)
  if (pending.length === 0 && pendingTools.length === 0) return null
  return (
    <div
      style={{ zIndex: Z.dropdown }}
      className="pointer-events-none fixed bottom-4 right-4 flex flex-col gap-2"
    >
      {pending.map((c) => (
        <div key={c.id} className="pointer-events-auto">
          <Card cmd={c} />
        </div>
      ))}
      {pendingTools.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToolCard tool={t} />
        </div>
      ))}
    </div>
  )
}
