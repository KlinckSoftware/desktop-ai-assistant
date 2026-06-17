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

// Mutable app-wide state shared across main-process modules.
class AppState {
  mainWindow: BrowserWindow | null = null
  projectRoot: string = defaultRoot()

  send(channel: string, ...args: unknown[]): void {
    this.mainWindow?.webContents.send(channel, ...args)
  }
}

export const appState = new AppState()
