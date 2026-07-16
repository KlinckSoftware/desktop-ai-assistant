# Desktop AI Assistant

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

> Maintained by **Klinck Software LLC**.

An Electron desktop **cockpit for orchestrating multiple AI coding agents** — CLI
agents and API providers, side by side, with a shared context pool, agent
hand-off, debate, saved pipelines, **per-agent git-worktree isolation**, a
**review/merge** flow, and a **scheduler** for unattended runs. The app is a
process orchestrator: no web scraping, no browser automation. There's an in-app
**Guide** (top-bar `? Guide`, auto-opens on first run) that walks through all of it.

> **Screenshots:** coming soon — the app's own in-app Guide is the best current
> walkthrough until screenshots/GIFs are added here.

## What it runs

- **CLI agents** — any command-line agent (Claude Code, Gemini CLI, Aider, Codex,
  OpenCode, Qwen, Crush, Goose, cursor-agent, Continue, Copilot, …) spawned as an
  interactive `node-pty` session and rendered in xterm.js. Built-ins are listed in
  a registry and merged with a user-editable `agents.json`; availability is probed
  on `PATH`. Billed to your own account/login for that tool.
- **API chats** — any OpenAI-compatible provider (OpenAI, Google Gemini via its
  OpenAI-compatible endpoint, Groq, Mistral, OpenRouter, Ollama). Streaming chat
  with built-in tools + MCP, per-panel model picker, keys in the OS keychain.
  Extendable via `api_providers.json`.
- **MCP** — Model Context Protocol servers (stdio) are connected on startup and
  their tools exposed to the agentic loops.

## Features

- **Dockable panels** (dockview) — agents, chats, editor, terminal, git, diff,
  checkpoints, debate, cockpit, pipelines, **review**, **runs**. Layout persists.
- **Shared context pool** — check files once; they ride along with every
  prompt-controlled agent. Optional **repo map** (a symbol outline of the project)
  can be pinned into context. CLI agents get an "inject context" button.
- **Built-in tools** — read-only auto tools (`read_file`, `list_dir`, `repo_map`,
  `search_code`, `git_diff`) plus gated `apply_edit` / `write_file` / `run_command`
  and all MCP tools. API + Gemini share the same tools **and** the same tool-usage
  system prompt, so they behave alike.
- **Per-agent isolation** — each CLI-agent session and each pipeline run works in
  its **own git worktree on its own branch** (needs a git repo with a commit; else
  it falls back to the shared folder). Parallel agents can't stomp each other, and
  an agent is confined to a branch. Idle worktrees auto-prune on launch.
- **Review & merge** — the **Review** panel lists each branch with its age and
  **↑ahead ↓behind** counts, shows its diff vs the fork point, and offers
  **Merge** (squash into base), **Discard** (+ "Discard all"), an ordered
  **queue-merge** of checked branches (stops at the first conflict), **per-hunk
  apply** (cherry-pick selected hunks onto the base), and an opt-in **PR**
  button (push the branch + open a GitHub PR via `gh`).
- **Agent hand-off** — park one agent's reply and pick it up in another
  (Gemini / API input, or a CLI prompt).
- **Debate** — pick **2–4 usable participants** (Claude, Gemini, or keyed API
  providers); every seat proposes in round 1, then round-robin critiques over N
  rounds, and a chosen **synthesizer** merges the result (gated by explicit
  approval). Claude is tool-constrained per phase (read-only rounds, edit
  synthesis). Cancellable mid-run.
- **Pipelines** — build a small **graph**, not just a chain: per step a permission
  preset (read-only / edit / full), model + effort, **inputs** (fan-in from earlier
  steps), an **only-if-contains** condition, and **map** (run per input line).
  Run in topological order; `${id}`/`${input}` interpolation; **templates**
  (plan→implement→review); **dry-run**; live **cancel**; persisted **run history**.
  A `full` step runs shell only with an explicit **allow-shell** opt-in.
- **Runs & scheduler** — the **Runs** panel shows every run (manual, background, or
  scheduled) live; runs survive closing their panel and are serialized. **Settings
  → Schedules** runs a saved pipeline on a trigger — every N minutes, daily, or on
  a git/file change (unattended/autonomous; in-app, i.e. while the app is open or
  minimized to tray — see **Settings → Close to tray**).
- **Cockpit** — live fleet of open agents with model, status, provider-reported
  token usage and an estimated-cost meter (live LiteLLM price table, cached), plus
  a session total and an optional **cost cap** (enforced in main, so it also bounds
  scheduled/background runs).
- **Checkpoints** — every approved file edit is snapshotted and can be undone
  (autonomous pipeline edits included).
- **Settings** — a searchable, IntelliJ-style two-pane panel (section list + content):
  models, appearance, budget, pipeline/terminal/editor/startup prefs, **security**
  (approval timeout, secret-read guard, clear-history, and restrict/loosen knobs:
  always-confirm, default-allow-shell, allow-protected-writes), isolation,
  schedules, per-provider keys, MCP servers, and links to manage agents/providers.

## Install & run

### From the installer (Windows)
1. Get `Desktop AI Assistant-<version>-setup.exe` (and `SHA256SUMS.txt`) from the
   [Releases](../../releases) page, if one is published.
2. **Verify it first** (the build is unsigned):
   ```powershell
   Get-FileHash "Desktop AI Assistant-<version>-setup.exe" -Algorithm SHA256
   ```
   The hash must match the line in `SHA256SUMS.txt`. If it doesn't match, don't run it.
3. Run the installer. Windows SmartScreen may warn (unsigned): **More info →
   Run anyway**. It installs per-user; choose the install dir if prompted.
4. Launch **Desktop AI Assistant**. On first run the **Guide** opens — start there.
5. Open **⚙ Settings → Keys** and add an API key (stored in the OS keychain), or
   make sure a CLI agent (e.g. `claude`) is on your `PATH`. Set a **cost cap**
   (Settings → Budget) if you'll use API providers.

### From source (any platform with Node 20+)
```
git clone https://github.com/<org>/desktopAI.git && cd desktopAI
npm install          # postinstall rebuilds native modules for Electron
npm run dev          # run with HMR
# or build an installer:
npm run dist:win     # NSIS installer + SHA256SUMS.txt in release/
```

See **[docs/DISTRIBUTING.md](docs/DISTRIBUTING.md)** for build/sharing/verification
notes, and **[SECURITY.md](SECURITY.md)** for the full trust model.

## Security model (summary)

Agents are treated as **untrusted** — their proposed commands, file writes, and
MCP tool calls are gated by default-deny brokers (`CommandBroker`,
`FileEditBroker`, `ToolBroker`) in the trusted main process; the renderer is
sandboxed (context isolation on, no node integration, CSP locked to `'self'`).
Unattended pipeline/scheduled runs go through a separate `autonomous` policy
(allowlist + dangerous-command denylist, no human in the loop) with a session
cost cap enforced in main. Full details, every gate, and known residual risks
are documented in **[SECURITY.md](SECURITY.md)** — read it before pointing this
at a repo or credentials you care about.

## Architecture

```
Main (Node)
├── AgentProcessManager   — node-pty interactive CLI agents (generic)
├── ClaudeHeadless        — one-shot `claude -p` (debate / pipeline Claude step)
├── GeminiClient          — native streaming REST + tools (multimodal)
├── OpenAIClient          — streaming /chat/completions + tools + usage capture
├── systemPrompt          — shared AGENT_SYSTEM + MAX_TOOL_TURNS (api ≡ gemini)
├── CommandBroker         — default-deny gate for shell commands
├── CommandExecutor       — pty shell + execOnce(cwd) for worktree commands
├── FileEditBroker        — default-deny gate for file writes + checkpoints
├── MCPClientManager      — connects stdio MCP servers, proxies their tools
├── ToolBroker            — default-deny gate for MCP tool calls
├── ApprovalPolicy        — main-side decision: interactive | autonomous | dry-run
├── budget                — main-side session spend cap (covers scheduled runs)
├── FileSystemManager     — root-confined fs ops (protected-path block) + watch + repo map
├── WorktreeManager       — per-session git worktrees (isolation, prune, merge/discard)
├── KeychainManager       — keytar (graceful fallback)
├── IPCModerator          — structured two-participant debate
├── PipelineRunner        — runs a pipeline graph (topo, conditional, map) in one worktree
├── RunManager            — serialized run queue, main-owned records (background-safe)
└── Scheduler + JobStore  — in-app cron (interval / daily / git) over saved pipelines
```

Renderer is React + Vite + Tailwind + dockview. All IPC goes through a typed
`window.api` bridge (`src/preload`). Context isolation on, node integration off,
CSP locked to `'self'`.

See **[SECURITY.md](SECURITY.md)** for the trust model and where each gate lives.

## Commands

```
npm install       # deps; postinstall rebuilds native modules for Electron
npm run dev       # electron-vite dev with HMR
npm run typecheck # tsc (node + web projects)
npm test          # vitest unit tests
npm run dist:win  # NSIS installer (close the dev app first — native file locks)
```

Native modules (`node-pty`, `keytar`) are rebuilt against the Electron ABI by the
`postinstall` hook. If they fail, run `npm run rebuild`.

## Notes / caveats

- CLI agents run their own tooling in a real pty — they are **not** sandboxed by
  the app's brokers (full shell access, governed by that tool's own permissions),
  but isolation now confines an agent to its own worktree/branch.
- API/Gemini chats and pipelines route tool calls through the app's brokers; for
  unattended pipeline/scheduled steps an `ApprovalPolicy` (interactive | autonomous
  | dry-run) enforces an allowlist + the dangerous-command denylist in main. A
  `full` step's shell is off unless the run opts in. Writes to `.git/` and
  `node_modules/` are blocked, and secret files (`.env`, keys) aren't read by tools
  — both overridable in Settings → Security.
- Scheduled jobs run while the app is open, or in the background if minimized to
  the system tray (**Settings → Close to tray**, default off — closing the window
  quits the app unless enabled). No headless/background daemon otherwise.
- See **[SECURITY.md](SECURITY.md)** for the full trust model and every gate.
- ToS: this drives real authenticated processes. Review Anthropic/Google/OpenAI
  (etc.) terms for your use case.

## Contributing

Contributions are welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)** for dev
setup, branch/PR conventions, and test expectations. For security issues, please
follow the private disclosure process in **[SECURITY.md](SECURITY.md)** instead
of opening a public issue.

## License

[Apache License 2.0](LICENSE) © 2026 Klinck Software LLC
