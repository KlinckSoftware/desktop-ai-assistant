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

1. **Interactive approvals trust the renderer (narrowed).** The renderer decides
   whether to auto-approve (trusted session) or show a card. Main now enforces the
   dangerous denylist in `CommandBroker.approve()` itself: a dangerous command can
   only run via the explicit `confirmDangerous()` path that the human-facing card
   invokes — so a renderer bug or trusted-session auto-approve can **not** silently
   run a dangerous command. Residual: a *fully compromised* renderer could call
   `confirmDangerous()` (or `ToolBroker`/`FileEditBroker.approve()`, which are not
   yet denylist-gated) directly. The renderer can also create autonomous scheduled
   jobs (`jobSave`) and remove/merge worktrees (`worktreeRemove`); these stay
   within the "renderer is semi-trusted" model — they're human-initiated UI
   actions — but a *fully compromised* renderer could abuse them (e.g. schedule a
   `full` job, or discard a worktree's uncommitted work). The **autonomous**
   execution path itself is fully main-authoritative. A complete fix
   (a nonce/handshake proving an action was genuinely initiated by a human) is
   future work.
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
3. **MCP tool arguments are not pattern-screened.** MCP calls are gated by
   approval/allowlist but there is no dangerous-argument denylist for them.
4. **`sandbox: false`** is required for the ESM preload. Context isolation is
   still enforced; the preload exposes only the bounded `window.api`.

## Reporting

This is a personal project. If you find a security issue, open an issue (omit any
exploit details that would put other users at risk) or contact the maintainer.
