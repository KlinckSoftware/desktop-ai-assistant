import { checkDangerous } from '../../shared/dangerousCommand'

// The single MAIN-side authority for whether a proposed operation may run.
// Critical: for unattended (autonomous) execution there is no human clicking
// approve, so the safety decision MUST live here in main — not in renderer
// click-gating, which a compromised/buggy renderer could bypass.
//
//   interactive — defer to the existing human approval card (today's behavior)
//   autonomous  — run only if the capability is allowlisted for this step AND
//                 (for shell commands) it isn't on the dangerous denylist;
//                 otherwise BLOCK + log and let the caller continue
//   dryrun      — never execute; report what would have happened

export type ApprovalMode = 'interactive' | 'autonomous' | 'dryrun'

export interface ApprovalPolicy {
  mode: ApprovalMode
  allow?: string[] // capability/tool names permitted in autonomous mode
}

export type Decision =
  | { action: 'interactive' }
  | { action: 'run' }
  | { action: 'dryrun' }
  | { action: 'block'; reason: string }

// `kind` is the coarse capability name to allowlist-check (e.g. 'run_command',
// an MCP tool's qualified name, 'apply_edit'). `command` is supplied for shell
// commands so the dangerous denylist is enforced here, in main.
export function decide(policy: ApprovalPolicy, kind: string, command?: string): Decision {
  if (policy.mode === 'interactive') return { action: 'interactive' }
  if (policy.mode === 'dryrun') return { action: 'dryrun' }

  // autonomous
  if (command) {
    const d = checkDangerous(command)
    if (d.dangerous) return { action: 'block', reason: `dangerous command (${d.reason})` }
  }
  const allow = policy.allow ?? []
  if (!allow.includes(kind)) return { action: 'block', reason: `'${kind}' is not allowed for this step` }
  return { action: 'run' }
}

export const INTERACTIVE: ApprovalPolicy = { mode: 'interactive' }
