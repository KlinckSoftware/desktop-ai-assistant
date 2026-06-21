# Desktop AI Assistant

An Electron desktop **cockpit for orchestrating multiple AI coding agents** — CLI
agents and API providers, side by side, with a shared context pool, agent
hand-off, debate, and saved pipelines. The app is a process orchestrator: no web
scraping, no browser automation.

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
  checkpoints, debate, cockpit, pipelines. Layout persists.
- **Shared context pool** — check files once; they ride along with every
  prompt-controlled agent. Optional **repo map** (a symbol outline of the project)
  can be pinned into context. CLI agents get an "inject context" button.
- **Built-in tools** — read-only auto tools (`read_file`, `list_dir`, `repo_map`,
  `search_code`, `git_diff`) plus gated `apply_edit` / `write_file` / `run_command`
  and all MCP tools.
- **Agent hand-off** — park one agent's reply and pick it up in another
  (Gemini / API input, or a CLI prompt).
- **Debate** — pick any two usable participants (Claude, Gemini, or a keyed API
  provider); they propose / critique over N rounds, then one synthesizes (gated by
  explicit approval). Cancellable mid-run.
- **Pipelines** — chain participants so each step's output feeds the next. API
  and Claude steps do **gated, policy-bounded file work**: a per-step permission
  preset (read-only / edit / full) and per-step model + effort, a **dry-run**
  mode, live **cancel**, and persisted **run history** (re-run a past run). Save
  and reuse named chains.
- **Cockpit** — live fleet of open agents with model, status, provider-reported
  token usage and an estimated-cost meter (live LiteLLM price table, cached), plus
  a session total and an optional **cost cap** that blocks new API sends.
- **Checkpoints** — every approved file edit is snapshotted and can be undone
  (autonomous pipeline edits included).
- **Settings** — one searchable, sectioned panel: models, appearance (accent),
  budget, pipeline/terminal/editor/startup prefs, security (incl. configurable
  approval timeout), per-provider API keys, MCP servers (with an add form), and
  links to manage agents/providers.

## Architecture

```
Main (Node)
├── AgentProcessManager   — node-pty interactive CLI agents (generic)
├── ClaudeHeadless        — one-shot `claude -p` (debate / pipeline Claude step)
├── GeminiClient          — native streaming REST + tools (multimodal)
├── OpenAIClient          — streaming /chat/completions + tools + usage capture
├── CommandBroker         — default-deny gate for shell commands
├── CommandExecutor       — single pty shell, scrubbed env
├── FileEditBroker        — default-deny gate for file writes + checkpoints
├── MCPClientManager      — connects stdio MCP servers, proxies their tools
├── ToolBroker            — default-deny gate for MCP tool calls
├── ApprovalPolicy        — main-side decision: interactive | autonomous | dry-run
├── FileSystemManager     — root-confined fs ops + chokidar watch + repo map
├── KeychainManager       — keytar (graceful fallback)
├── IPCModerator          — structured two-participant debate
└── PipelineRunner        — runs saved agent pipelines
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
  the app's brokers (they have full shell access, governed by that tool's own
  permissions). Prefer pointing the project root at the repo you intend to work on.
- API/Gemini chats and pipelines route tool calls through the app's brokers; for
  unattended pipeline steps an `ApprovalPolicy` (interactive | autonomous | dry-run)
  enforces an allowlist + the dangerous-command denylist in main. The pipeline
  Claude step is constrained via `--allowedTools` per its permission preset.
- ToS: this drives real authenticated processes. Review Anthropic/Google/OpenAI
  (etc.) terms for your use case.
