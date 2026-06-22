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
  if (!allow.includes('*') && !allow.includes(kind)) {
    return { action: 'block', reason: `'${kind}' is not allowed for this step` }
  }
  return { action: 'run' }
}

export const INTERACTIVE: ApprovalPolicy = { mode: 'interactive' }

// Per-step permission presets (pipeline UI). Map to an autonomous allowlist.
export type PermissionMode = 'read-only' | 'edit' | 'full'

const READ_ONLY = ['read_file', 'list_dir', 'repo_map', 'search_code', 'git_diff']
const EDIT = [...READ_ONLY, 'apply_edit', 'write_file']
const ALLOW: Record<PermissionMode, string[]> = {
  'read-only': READ_ONLY,
  edit: EDIT,
  full: ['*'] // everything (incl. run_command + MCP); dangerous commands still blocked
}

/**
 * Build the policy for a pipeline step from its preset + the run's dry-run flag.
 * `full` (the `*` wildcard — autonomous shell + MCP) is only honored when the run
 * was explicitly opted into it (`allowFull`); otherwise it is downgraded to `edit`
 * so an unattended run can't run arbitrary commands without a human deciding to.
 */
export function policyForStep(mode: PermissionMode, dryRun: boolean, allowFull = false): ApprovalPolicy {
  if (dryRun) return { mode: 'dryrun' }
  const effective: PermissionMode = mode === 'full' && !allowFull ? 'edit' : mode
  return { mode: 'autonomous', allow: ALLOW[effective] }
}
