import { BrowserWindow, app } from 'electron'

// Sensible default working folder — the same dir Claude's pty and the file tree
// open in. In dev that's the launch cwd (the repo); packaged, the install dir is
// useless, so fall back to Documents (watch-safe, unlike the home dir whose
// Windows junctions throw EPERM). A persisted/picked root overrides this.
function defaultRoot(): string {
  try {
    if (app.isPackaged) return app.getPath('documents')
  } catch {
    /* getPath unavailable pre-ready on some platforms */
  }
  return process.cwd()
}

export interface Settings {
  geminiModel: string
  claudeModel: string // '' = use the claude CLI default; else passed via --model
  claudeEffort: string // '' = default; else passed via --effort (low/medium/high)
  debateRounds: number
  terminalShell: 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh'
  isolateAgents: boolean // run each CLI-agent session in its own git worktree/branch
  costCap: number // USD session spend ceiling enforced in main (0 = no cap)
  allowSecretReads: boolean // let tools read secret-looking files (.env, keys) — default off
  allowProtectedWrites: boolean // permit writes to .git/ & node_modules/ — default off (LOOSEN)
  pipelineAllowFullDefault: boolean // default the per-run "allow shell (full)" opt-in — default off
  autonomousAllow: string // optional allowlist of command heads for autonomous run_command ('' = no extra restriction)
}

// Mutable app-wide state shared across main-process modules.
class AppState {
  mainWindow: BrowserWindow | null = null
  projectRoot: string = defaultRoot()
  settings: Settings = {
    geminiModel: 'gemini-2.5-flash',
    claudeModel: '',
    claudeEffort: '',
    debateRounds: 3,
    terminalShell: 'default',
    isolateAgents: true,
    costCap: 0,
    allowSecretReads: false,
    allowProtectedWrites: false,
    pipelineAllowFullDefault: false,
    autonomousAllow: ''
  }

  // sessionId -> the isolated worktree root that session operates in. Sessions
  // without an entry fall back to the shared projectRoot.
  private sessionRoots = new Map<string, string>()

  setSessionRoot(sessionId: string, root: string): void {
    this.sessionRoots.set(sessionId, root)
  }
  clearSessionRoot(sessionId: string): void {
    this.sessionRoots.delete(sessionId)
  }
  /** The working root for a session: its isolated worktree, else the shared root. */
  rootFor(sessionId?: string): string {
    return (sessionId && this.sessionRoots.get(sessionId)) || this.projectRoot
  }

  send(channel: string, ...args: unknown[]): void {
    const win = this.mainWindow
    // pty processes can emit data after the window is torn down; sending to a
    // destroyed webContents throws "Object has been destroyed".
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(channel, ...args)
  }
}

export const appState = new AppState()
