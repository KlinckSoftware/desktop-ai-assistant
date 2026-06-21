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

### Approval modes (`ApprovalPolicy`, main)

- **interactive** — the operation surfaces an approval card; a human approves or
  rejects. Per-session "trust" can auto-approve, **except** commands matching the
  dangerous denylist, which always require an explicit card.
- **autonomous** — for unattended runs (e.g. pipelines). Main decides with **no
  human**: it runs only if the capability is allow-listed for that step **and**
  (for shell commands) it is not on the dangerous denylist. Otherwise it is
  **blocked and logged**, and the run continues.
- **dry-run** — nothing executes; the intended operation is reported.

The dangerous denylist (`src/shared/dangerousCommand.ts`) always-flags recursive
deletes, disk writes, fork bombs, pipe-to-interpreter, privilege escalation,
power control, **process kills** (so an agent can't kill this app), registry
writes, publishes, remote transfer, and credential-path access.

### Credential hygiene

- API keys live in the OS keychain (keytar), never in `state.json`.
- Spawned shells and agents get a **scrubbed environment** (`cleanClaudeEnv`):
  `CLAUDECODE`, `CLAUDE_CODE_*`, and `ANTHROPIC_*` are stripped so a child can't
  inherit the launching app's credentials/proxy.
- `openExternal` only opens `http(s)` URLs.

## Known limitations / residual risk

1. **Interactive approvals trust the renderer (narrowed).** The renderer decides
   whether to auto-approve (trusted session) or show a card. Main now enforces the
   dangerous denylist in `CommandBroker.approve()` itself: a dangerous command can
   only run via the explicit `confirmDangerous()` path that the human-facing card
   invokes — so a renderer bug or trusted-session auto-approve can **not** silently
   run a dangerous command. Residual: a *fully compromised* renderer could call
   `confirmDangerous()` (or `ToolBroker`/`FileEditBroker.approve()`, which are not
   yet denylist-gated) directly. The **autonomous** path is fully main-authoritative.
   A complete fix (nonce/handshake proving an approval was genuinely surfaced to a
   human) is future work.
2. **CLI agents are not sandboxed by the app.** A `node-pty` CLI agent (e.g.
   Claude Code) has full shell access governed only by that tool's own
   permissions — it bypasses the app's brokers entirely. Treat CLI agents with the
   same caution as running that CLI yourself. The `claude -p` step used by
   debate/pipelines is being constrained via `--allowedTools` (in progress).
3. **MCP tool arguments are not pattern-screened.** MCP calls are gated by
   approval/allowlist but there is no dangerous-argument denylist for them.
4. **`sandbox: false`** is required for the ESM preload. Context isolation is
   still enforced; the preload exposes only the bounded `window.api`.

## Reporting

This is a personal project. If you find a security issue, open an issue (omit any
exploit details that would put other users at risk) or contact the maintainer.
