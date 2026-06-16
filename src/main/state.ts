import { BrowserWindow } from 'electron'
import { homedir } from 'os'

// Mutable app-wide state shared across main-process modules.
class AppState {
  mainWindow: BrowserWindow | null = null
  projectRoot: string = homedir()

  send(channel: string, ...args: unknown[]): void {
    this.mainWindow?.webContents.send(channel, ...args)
  }
}

export const appState = new AppState()
