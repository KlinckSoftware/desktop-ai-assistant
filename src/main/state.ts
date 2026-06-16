import { BrowserWindow } from 'electron'

// Mutable app-wide state shared across main-process modules.
class AppState {
  mainWindow: BrowserWindow | null = null
  // Default to the launch cwd, NOT homedir — watching the home dir hits Windows
  // junctions (Cookies, Local Settings) that throw EPERM. User picks a real root.
  projectRoot: string = process.cwd()

  send(channel: string, ...args: unknown[]): void {
    this.mainWindow?.webContents.send(channel, ...args)
  }
}

export const appState = new AppState()
