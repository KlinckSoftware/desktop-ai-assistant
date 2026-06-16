import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { appState } from './state'
import { CH, type Message } from '../shared/types'
import { CommandExecutor } from './executor/CommandExecutor'
import { CommandBroker } from './executor/CommandBroker'
import { ClaudeProcessManager } from './claude/ClaudeProcessManager'
import { GeminiClient } from './gemini/GeminiClient'
import { FileSystemManager } from './fs/FileSystemManager'
import { IPCModerator } from './moderator/IPCModerator'

let executor: CommandExecutor
let broker: CommandBroker
let claude: ClaudeProcessManager
let gemini: GeminiClient
let fsm: FileSystemManager
let moderator: IPCModerator

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Desktop AI Assistant',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required so preload can use Node built-ins for the bridge
    }
  })

  appState.mainWindow = win
  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function initServices(): void {
  executor = new CommandExecutor(appState.projectRoot)
  broker = new CommandBroker(executor)
  claude = new ClaudeProcessManager(broker)
  gemini = new GeminiClient(broker)
  fsm = new FileSystemManager()
  moderator = new IPCModerator(gemini, broker)
  fsm.watch(appState.projectRoot)
}

function registerIpc(): void {
  // --- Claude ---
  ipcMain.handle(CH.claudeNewSession, (_e, sessionId: string) => {
    claude.spawn(sessionId, appState.projectRoot)
    return sessionId
  })
  ipcMain.handle(CH.claudeSend, (_e, sessionId: string, text: string) => claude.send(sessionId, text))
  ipcMain.on(CH.claudeStream, (_e, sessionId: string, data: string) => claude.write(sessionId, data))
  ipcMain.on(CH.claudeResize, (_e, sessionId: string, cols: number, rows: number) =>
    claude.resize(sessionId, cols, rows)
  )
  ipcMain.handle(CH.claudeKillSession, (_e, sessionId: string) => claude.kill(sessionId))

  // --- Gemini ---
  ipcMain.handle(CH.geminiSend, (_e, prompt: string, history: Message[]) =>
    gemini.send(prompt, history)
  )
  ipcMain.handle(CH.geminiHasKey, () => gemini.hasKey())
  ipcMain.handle(CH.geminiSaveKey, (_e, key: string) => gemini.saveKey(key))

  // --- Debate ---
  ipcMain.handle(CH.debateStart, (_e, prompt: string) => moderator.runDebate(prompt))

  // --- Terminal (direct user input) ---
  ipcMain.on(CH.terminalInput, (_e, data: string) => executor.writeRaw(data))
  ipcMain.on(CH.terminalResize, (_e, cols: number, rows: number) => executor.resize(cols, rows))

  // --- Command approval ---
  ipcMain.handle(CH.cmdApprove, (_e, id: string) => broker.approve(id))
  ipcMain.handle(CH.cmdReject, (_e, id: string) => broker.reject(id))

  // --- Filesystem ---
  ipcMain.handle(CH.fsReadTree, (_e, root?: string) => fsm.readTree(root || appState.projectRoot))
  ipcMain.handle(CH.fsReadFile, (_e, path: string) => fsm.readFile(path))
  ipcMain.handle(CH.fsWriteFile, (_e, path: string, content: string) => fsm.writeFile(path, content))
  ipcMain.handle(CH.appProjectRoot, () => appState.projectRoot)
  ipcMain.handle(CH.fsPickDir, async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return appState.projectRoot
    appState.projectRoot = res.filePaths[0]
    fsm.watch(appState.projectRoot)
    return appState.projectRoot
  })
}

app.whenReady().then(() => {
  initServices()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  claude?.killAll()
  fsm?.dispose()
  if (process.platform !== 'darwin') app.quit()
})
