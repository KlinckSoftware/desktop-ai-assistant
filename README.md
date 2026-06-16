# Desktop AI Assistant

Electron desktop shell around two real AI agents:

- **Claude** — the `claude` (Claude Code) CLI, spawned as an interactive `node-pty`
  session and rendered in xterm.js. Billed to your Claude subscription.
- **Gemini** — direct REST calls to the Gemini API (`gemini-2.5-flash`), key stored
  in the OS keychain via keytar.

No web scraping, no browser automation. The app is a process orchestrator.

## Architecture

```
Main (Node)
├── ClaudeProcessManager  — node-pty interactive `claude` sessions
├── ClaudeHeadless        — one-shot `claude -p` for the debate moderator
├── GeminiClient          — streaming REST (alt=sse), bounded agentic loop
├── CommandBroker         — default-deny approval gate for agent commands
├── CommandExecutor       — single pty shell, sentinel-based completion detection
├── FileSystemManager     — fs ops + chokidar watching
├── KeychainManager       — keytar (graceful fallback if native load fails)
└── IPCModerator          — structured Claude<->Gemini debate

Renderer (React + Vite + Tailwind, allotment panes)
├── ClaudePane    — xterm bound to the interactive Claude session
├── GeminiChat    — streaming chat
├── TerminalPane  — xterm bound to the executor shell
├── FileTreePanel
├── DebateView
└── CommandToast  — approve / reject / trust, auto-rejects after 15s
```

All IPC goes through a typed `window.api` bridge (`src/preload`). Context isolation
on, node integration off.

## Security model

Agent-proposed `` ```bash run `` blocks never execute automatically. Each becomes a
PendingCommand the user must approve. "Trust" auto-approves future commands **from
that session only**. Timeout default-rejects.

## Commands

```
npm install      # installs deps; postinstall rebuilds native modules for Electron
npm run dev      # electron-vite dev with HMR
npm run typecheck
npm run dist:win # NSIS installer
```

Native modules (`node-pty`, `keytar`) are rebuilt against the Electron ABI by the
`postinstall` hook. If they fail, run `npm run rebuild`.

## Notes / caveats

- Claude Code runs its own tools; the `` ```bash run `` sniffing on the Claude pty is a
  fallback — the main execution path for parsed blocks is Gemini, which has no native
  shell access.
- The debate moderator uses headless `claude -p` for clean, capturable turns.
- ToS: this drives real authenticated processes. Programmatic injection is still
  automation — review Anthropic/Google terms for your use case.
