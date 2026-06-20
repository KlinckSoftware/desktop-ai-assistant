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
  debateRounds: number
  terminalShell: 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh'
}

// Mutable app-wide state shared across main-process modules.
class AppState {
  mainWindow: BrowserWindow | null = null
  projectRoot: string = defaultRoot()
  settings: Settings = { geminiModel: 'gemini-2.5-flash', debateRounds: 3, terminalShell: 'default' }

  send(channel: string, ...args: unknown[]): void {
    const win = this.mainWindow
    // pty processes can emit data after the window is torn down; sending to a
    // destroyed webContents throws "Object has been destroyed".
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send(channel, ...args)
  }
}

export const appState = new AppState()
