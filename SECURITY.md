# Security model

This app spawns real AI agents that can read files, run shell commands, edit
code, and call MCP tools. The security model is about **keeping the human (or an
explicit policy) in control of every side-effecting operation**, and about
limiting the blast radius when something behaves unexpectedly.

## Trust boundaries

- **Main process** is trusted. It is the authority for what actually executes.
- **Renderer** is treated as semi-trusted: context isolation is on, node
  integration is off, and the only bridge is a typed `window.api` (`src/preload`).
  Content Security Policy is locked to `'self'` (`src/renderer/index.html`), and
  the renderer makes no direct network calls — everything goes through main.
- **Agents** (CLI processes, API models, MCP servers) are **untrusted**. Their
  output is data, never instructions to the app. Proposed commands/edits/tool
  calls are gated.

## Gates

| Operation | Gate | Where enforced |
|-----------|------|----------------|
| Shell command (parsed/API/pipeline) | `CommandBroker` | main |
| File write / edit | `FileEditBroker` (+ checkpoint snapshot) | main |
| MCP tool call | `ToolBroker` | main |
| Read-only built-in tools | none (no side effects, root-confined) | main |
| File reads/writes | confined to the project root (`assertInRoot`) | main |
| Write to `.git/` or `node_modules/` | refused at `FileSystemManager.writeFile` | main |

Writes that resolve into `.git/` or `node_modules/` are **refused** at the
`FileSystemManager.writeFile` chokepoint — the single path every write passes
through (edit broker, checkpoint undo, `fs:write`). This closes a git-hook RCE
vector: a planted `.git/hooks/pre-commit` would execute on the next git op and
bypass the shell denylist entirely. The classifier is `isProtectedPath` in
`shared/protectedPath.ts`, matching on forward-slash path segments (OS-agnostic,
resists `.git/../.git` tricks).

### Approval modes (`ApprovalPolicy`, main)

- **interactive** — the operation surfaces an approval card; a human approves or
  rejects. Per-session "trust" can auto-approve, **except** commands matching the
  dangerous denylist, which always require an explicit card. Cards auto-reject
  after a configurable timeout (Settings → Security; default 15s, 0 = never) —
  default-deny: doing nothing rejects.
- **autonomous** — for unattended runs (pipelines). Main decides with **no
  human**: it runs only if the capability is allow-listed for that step **and**
  (for shell commands) it is not on the dangerous denylist. Otherwise it is
  **blocked and logged**, and the run continues. Pipeline steps map a permission
  preset (read-only / edit / full) to the allowlist; edits still snapshot to
  checkpoints, so autonomous edits remain undoable.
- **dry-run** — nothing executes; the intended operation is reported.

The dangerous denylist (`src/shared/dangerousCommand.ts`) always-flags recursive
deletes, disk writes, fork bombs, pipe-to-interpreter, privilege escalation,
power control, **process kills** (so an agent can't kill this app), registry
writes, publishes, remote transfer, and credential-path access.

### Autonomous + scheduled surface

Pipelines and scheduled jobs run **unattended** — always through the
**autonomous** `ApprovalPolicy`, never interactive (`Scheduler` →
`RunManager.start` → `PipelineRunner`, all in main). Because no human is in the
loop, three extra guards bound them:

- **Main-side session cost cap** (`src/main/budget.ts`). The cap is now enforced
  in **main**, not just the renderer, so scheduled/background runs are bounded.
  `RunManager.start` refuses to launch a run once the cap is reached (marks it
  `error` and logs `[blocked: session cost cap reached]`), and the agentic loops
  stop at the next turn. It is a **soft cap**: the crossing turn may overshoot,
  debate one-shots aren't costed, and the total is an **estimate** from the
  shared price table (`shared/pricing`) over provider-reported usage.
- **`full` opt-in** (`policyForStep`). A `full` step (the `*` wildcard —
  autonomous shell / `Bash` / MCP) is **downgraded to `edit`** (file tools only)
  unless the run or job explicitly opts in via `allowFull`. So an unattended run
  can't run arbitrary commands unless a human chose that. The Schedules UI
  requires an "I understand" tick before a `full` job can be saved.
- **git-trigger self-trigger guard** (`Scheduler`). A git-triggered job can't
  re-fire while its own run is queued or running, plus a 60s minimum gap between
  fires — so an editing job can't loop on its own output.
- **Optional command allowlist** (Settings → Security, `autonomousAllow`). When
  set, an autonomous `run_command` only runs if its first word is in the list —
  on top of the always-on dangerous denylist. Blank = allow any non-dangerous
  command.
- **MCP argument screening.** Autonomous MCP calls refuse when their serialized
  arguments match the dangerous denylist (e.g. a tool taking a shell/url arg with
  `rm -rf` or a remote transfer), in `ToolBroker`.

Autonomous steps that fall outside the step's allowlist (or hit the dangerous
denylist) are **blocked and logged**, and the run continues. Edits still snapshot
to checkpoints, so autonomous edits remain undoable.

### Credential hygiene

- API keys live in the OS keychain (keytar), never in `state.json`.
- Spawned shells and agents get a **scrubbed environment** (`cleanClaudeEnv`):
  `CLAUDECODE`, `CLAUDE_CODE_*`, and `ANTHROPIC_*` are stripped so a child can't
  inherit the launching app's credentials/proxy.
- `openExternal` only opens `http(s)` URLs.
- **Secret-path read guard.** The tool read path (`read_file`, `search_code`)
  refuses secret-looking files — `.env*`, private keys, `*.pem`/`*.key`/`*.pfx`,
  `credentials`, and anything under `.ssh`/`.aws`/`.gnupg` — and drops them from
  search hits, so their contents aren't shipped to a provider. This is gated by
  `allowSecretReads` in Settings (default **off**). The editor UI (explicit user
  open) is unaffected — only the tool/agent path is guarded. Helper:
  `isSecretPath` in `shared/protectedPath.ts`.
- An optional session **cost cap** (Settings → Budget) blocks new API sends once
  estimated spend reaches it — a runaway-cost backstop. It is now enforced in
  **main** (`src/main/budget.ts`), so it covers not just interactive API chats
  but also scheduled and background pipeline runs (see *Autonomous + scheduled
  surface*). It is a soft, estimated cap.

## Privacy / data at rest

- **Unencrypted local storage.** History (chats, debate transcripts, run outputs)
  and `jobs.json` are stored **unencrypted** in the app's userData directory. Run
  transcripts can contain file contents an agent read. Anyone with access to that
  directory can read them.
- **Mitigations shipped:** a **"Clear chat & run history"** action and a
  **"persist run output text"** toggle (Settings → Security). With persistence
  off, run history keeps metadata only — no output text.
- **Egress.** Files an agent reads or you `@`-mention are sent to the selected
  provider. In a **multi-provider pipeline**, that content can be spread across
  multiple vendors (one step's Claude read may feed a later Gemini step, etc.).

## Known limitations / residual risk

1. **Interactive approvals are nonce-gated (narrowed further).** Every pending
   command, MCP tool call, and file edit is minted with a cryptographically
   random, single-use nonce (`node:crypto` `randomUUID`) when the approval card
   is created (`CommandBroker`, `ToolBroker`, `FileEditBroker`). The nonce travels
   to the renderer as part of the pending payload (`PendingCommand.nonce`,
   `PendingTool.nonce`, `PendingEdit.nonce`) and every approve/reject/
   confirmDangerous call — including the trusted-session and trusted-tool
   auto-approve paths in `App.tsx` — must echo that exact nonce back over IPC.
   Main verifies the echoed nonce against the one it minted before doing
   anything: a mismatched or missing nonce blocks the action outright (nothing
   executes), consumes and removes the pending entry so it cannot be replayed,
   logs a `console.warn('[security] ... nonce mismatch ...')`, and resolves the
   waiting model/UI with a `[blocked: approval nonce mismatch]` result so
   nothing is left hanging. Because the previously-guessable sequential id
   (`cmd_7`, `tool_3`, `edit_12`) is no longer sufficient on its own, a
   compromised renderer can no longer forge an approval, rejection, or dangerous
   confirmation for an operation it was never actually shown — it would have to
   have genuinely received that specific pending message first, and the nonce
   is consumed the moment it is used. Main's dangerous-denylist gate in
   `CommandBroker.approve()`/`ToolBroker.approve()` still applies underneath the
   nonce check, so `confirmDangerous()` remains the only path that can run a
   flagged dangerous command or MCP call, and it is now nonce-gated too.
   Residual: the renderer can still create autonomous scheduled jobs (`jobSave`)
   and remove/merge worktrees (`worktreeRemove`) without a pending-card/nonce
   handshake; these stay within the "renderer is semi-trusted" model — they're
   human-initiated UI actions with no proposal to forge — but a *fully
   compromised* renderer could still abuse them directly (e.g. schedule a `full`
   job, or discard a worktree's uncommitted work). The **autonomous** execution
   path itself remains fully main-authoritative and is unaffected by this change
   (it never goes through the approval-card/nonce flow at all).
2. **Interactive CLI agents are not sandboxed by the app.** A `node-pty` CLI
   agent (e.g. Claude Code in a panel) has full shell access governed only by that
   tool's own permissions — it bypasses the app's brokers entirely. (They are now
   worktree-isolated, so an isolated agent's writes land in its own worktree, but
   the app does not otherwise sandbox the process.) Treat interactive CLI agents
   with the same caution as running that CLI yourself.
   The **pipeline** `claude -p` step is constrained: its `--allowedTools` is set
   from the step's permission preset (read-only → `Read/Grep/Glob/LS`; edit → adds
   `Edit/Write/MultiEdit`; full → adds `Bash` **only when the run opted into
   `allowFull`**, else capped at edit tools), so a pipeline step can't exceed its
   grant. (Claude still applies its own permission checks within that set.)
3. **MCP argument screening is denylist-only and autonomous-only.** Autonomous
   MCP calls now refuse arguments matching the dangerous denylist (`ToolBroker`),
   but that's a heuristic on the serialized args, not per-schema validation;
   *interactive* MCP calls rely on the approval card / trusted-tool flag rather
   than argument screening.
4. **`sandbox: false`** is required for the ESM preload. Context isolation is
   still enforced; the preload exposes only the bounded `window.api`.

## Reporting

This project is maintained by Klinck Software LLC. If you find a security issue,
please **do not** open a public issue with exploit details. Instead, report it
privately to **security@klincksoftware.com** with a description of the issue, steps to
reproduce, and potential impact. We'll acknowledge receipt and follow up with a
timeline once triaged. Non-sensitive hardening suggestions are welcome as normal
GitHub issues.
