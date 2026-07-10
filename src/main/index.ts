import { app, BrowserWindow, ipcMain, dialog, Menu, shell, clipboard } from 'electron'
import { join } from 'path'
import { appState } from './state'
import { CH, type Message } from '../shared/types'
import { CommandExecutor } from './executor/CommandExecutor'
import { CommandBroker } from './executor/CommandBroker'
import { FileEditBroker } from './editor/FileEditBroker'
import { AgentProcessManager } from './agents/AgentProcessManager'
import {
  listAgents,
  getAgent,
  saveAgent,
  removeAgent,
  ensureConfig as ensureAgentConfig
} from './agents/registry'
import type { AgentDef } from '../shared/types'
import { GeminiClient } from './gemini/GeminiClient'
import { listClaudeModels } from './claude/listModels'
import { FileSystemManager } from './fs/FileSystemManager'
import { gitStatus, gitHead, gitChanges, gitStage, gitUnstage, gitCommit } from './fs/git'
import { buildRepoMap } from './fs/repoMap'
import { loadState, saveState } from './persistence'
import { mcpManager } from './mcp/MCPClientManager'
import { toolBroker } from './mcp/ToolBroker'
import {
  listProviders,
  saveProvider,
  removeProvider,
  saveKey as saveApiKey,
  getKey as getApiKey,
  ensureConfig as ensureApiConfig
} from './api/providers'
import { apiSend } from './api/OpenAIClient'
import { fetchLivePricing } from './api/livePricing'
import { setPriceOverrides } from '../shared/pricing'
import { setBrokers } from './tools/toolExec'
import type { ApiProvider } from '../shared/types'
import { IPCModerator } from './moderator/IPCModerator'
import { PipelineRunner } from './pipeline/PipelineRunner'
import { RunManager } from './pipeline/RunManager'
import { jobStore } from './schedule/JobStore'
import { Scheduler } from './schedule/Scheduler'
import type { ScheduledJob } from '../shared/types'
import type { PipelineStep, WorktreeInfo } from '../shared/types'
import { worktreeManager } from './worktree/WorktreeManager'
import { workingDiff } from './fs/git'

let executor: CommandExecutor
let broker: CommandBroker
let agents: AgentProcessManager
let gemini: GeminiClient
let fsm: FileSystemManager
let editBroker: FileEditBroker
let moderator: IPCModerator
let pipeline: PipelineRunner
let runManager: RunManager
let scheduler: Scheduler

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Desktop AI Assistant',
    // Packaged: use the bundled app icon for the window/taskbar (resources are
    // unpacked next to the exe). Dev falls back to Electron's default.
    ...(app.isPackaged ? { icon: join(process.resourcesPath, 'icon.ico') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload (.mjs) only loads with sandbox disabled (Electron constraint).
      // Isolation is still enforced by contextIsolation + the bounded window.api
      // bridge; the preload never exposes Node to the renderer. Switching to a
      // sandboxed CJS preload would require changing the preload build format.
      sandbox: false
    }
  })

  appState.mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    appState.mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function initServices(): void {
  executor = new CommandExecutor(appState.projectRoot)
  broker = new CommandBroker(executor)
  fsm = new FileSystemManager()
  editBroker = new FileEditBroker(fsm)
  agents = new AgentProcessManager()
  gemini = new GeminiClient()
  setBrokers(broker, editBroker, fsm) // shared tool exec for the API chats
  moderator = new IPCModerator(gemini, broker)
  pipeline = new PipelineRunner(gemini, moderator)
  runManager = new RunManager(pipeline)
  scheduler = new Scheduler(runManager, jobStore, fsm)
  fsm.watch(appState.projectRoot)
}

function registerIpc(): void {
  // --- CLI agents (Claude, Gemini CLI, Aider, Codex, …) ---
  ipcMain.handle(CH.agentList, () => listAgents())
  ipcMain.handle(CH.agentSave, (_e, def: AgentDef) => saveAgent(def))
  ipcMain.handle(CH.agentRemove, (_e, id: string) => removeAgent(id))
  ipcMain.handle(CH.agentNewSession, async (_e, sessionId: string, agentId: string, cwd?: string) => {
    const def = await getAgent(agentId)
    if (!def) throw new Error(`Unknown agent: ${agentId}`)
    // Isolation: when enabled and the caller didn't pin an explicit cwd, run the
    // agent in its own git worktree/branch so it can't stomp the shared tree or
    // other agents. Falls back to the shared root when the project isn't a repo.
    let runCwd = cwd || appState.projectRoot
    if (!cwd && appState.settings.isolateAgents) {
      const wt = await worktreeManager.create(appState.projectRoot, sessionId, 'agent').catch(() => null)
      if (wt) {
        runCwd = wt.path
        appState.setSessionRoot(sessionId, wt.path)
        worktreeManager.setLabel(sessionId, def.name)
        appState.send(CH.worktreeChanged)
      }
    }
    try {
      agents.spawn(sessionId, def, runCwd)
    } catch (e) {
      appState.send(CH.appError, `Failed to start ${def.name}: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
    return sessionId
  })
  ipcMain.handle(CH.agentSend, (_e, sessionId: string, text: string) => agents.send(sessionId, text))
  ipcMain.on(CH.agentInput, (_e, sessionId: string, data: string) => agents.write(sessionId, data))
  ipcMain.on(CH.agentResize, (_e, sessionId: string, cols: number, rows: number) =>
    agents.resize(sessionId, cols, rows)
  )
  ipcMain.handle(CH.agentKillSession, (_e, sessionId: string) => agents.kill(sessionId))

  // --- Agent isolation (worktrees) ---
  ipcMain.handle(CH.worktreeList, (): WorktreeInfo[] => worktreeManager.infos())
  ipcMain.handle(CH.worktreeDiff, (_e, sessionId: string) => {
    const wt = worktreeManager.get(sessionId)
    if (!wt) return ''
    return workingDiff(wt.path, wt.base)
  })
  ipcMain.handle(CH.worktreeRemove, async (_e, sessionId: string, mode: 'merge' | 'discard') => {
    const status = await worktreeManager.remove(appState.projectRoot, sessionId, mode)
    appState.clearSessionRoot(sessionId)
    appState.send(CH.worktreeChanged)
    return status
  })
  ipcMain.handle(CH.worktreeCreatePr, (_e, sessionId: string) => worktreeManager.createPr(appState.projectRoot, sessionId))

  // --- Gemini ---
  ipcMain.handle(
    CH.geminiSend,
    (_e, prompt: string, history: Message[], images?: { mime: string; base64: string }[]) =>
      gemini.send(prompt, history, images)
  )
  ipcMain.handle(CH.geminiSideSend, (_e, prompt: string) => gemini.sideSend(prompt))
  // --- Generic API chat agents ---
  ipcMain.handle(CH.apiProvidersList, () => listProviders())
  ipcMain.handle(CH.apiProviderSave, (_e, p: ApiProvider) => saveProvider(p))
  ipcMain.handle(CH.apiProviderRemove, (_e, id: string) => removeProvider(id))
  ipcMain.handle(CH.apiHasKey, async (_e, id: string) => (await getApiKey(id)) != null)
  ipcMain.handle(CH.apiSaveKey, (_e, id: string, key: string) => saveApiKey(id, key))
  ipcMain.handle(CH.apiSend, (_e, instanceId: string, providerId: string, model: string, history) =>
    apiSend(instanceId, providerId, model, history)
  )
  ipcMain.handle(CH.pricingLive, () => fetchLivePricing())

  ipcMain.handle(CH.geminiHasKey, () => gemini.hasKey())
  ipcMain.handle(CH.geminiSaveKey, (_e, key: string) => gemini.saveKey(key))
  ipcMain.handle(CH.geminiListModels, () => gemini.listModels())

  // --- Claude (model/effort option lists — see src/main/claude/listModels.ts) ---
  ipcMain.handle(CH.claudeListModels, () => listClaudeModels())

  // --- Debate ---
  ipcMain.handle(CH.debateAgents, () => moderator.listDebateAgents())
  ipcMain.handle(CH.debateStart, (_e, prompt: string, aId?: string, bId?: string) =>
    moderator.runDebate(prompt, aId, bId)
  )
  ipcMain.handle(CH.debateSynthesize, () => moderator.synthesize())
  ipcMain.handle(CH.debateDecline, () => moderator.decline())
  ipcMain.handle(CH.debateCancel, () => moderator.cancel())

  // --- Pipelines (runs go through RunManager: serialized, main-owned, background-safe) ---
  ipcMain.handle(CH.pipelineRun, (_e, steps: PipelineStep[], input: string, dryRun?: boolean, allowFull?: boolean) =>
    runManager.start(steps, input, dryRun, allowFull)
  )
  ipcMain.handle(CH.pipelineCancel, (_e, runId: string) => runManager.cancel(runId))
  ipcMain.handle(CH.pipelineRuns, () => runManager.list())
  ipcMain.handle(CH.pipelineClearRuns, () => runManager.clear())

  // --- Scheduled jobs ---
  ipcMain.handle(CH.jobList, () => jobStore.list())
  ipcMain.handle(CH.jobSave, (_e, job: ScheduledJob) => jobStore.save(job))
  ipcMain.handle(CH.jobRemove, (_e, id: string) => jobStore.remove(id))
  ipcMain.handle(CH.jobRunNow, (_e, id: string) => {
    const job = jobStore.list().find((j) => j.id === id)
    if (!job) throw new Error(`no such job: ${id}`)
    return scheduler.fire(job)
  })

  // --- Terminal (direct user input) ---
  ipcMain.on(CH.terminalInput, (_e, data: string) => executor.writeRaw(data))
  ipcMain.on(CH.terminalResize, (_e, cols: number, rows: number) => executor.resize(cols, rows))

  // --- Command approval ---
  ipcMain.handle(CH.cmdApprove, (_e, id: string) => broker.approve(id))
  ipcMain.handle(CH.cmdConfirmDangerous, (_e, id: string) => broker.confirmDangerous(id))
  ipcMain.handle(CH.cmdReject, (_e, id: string) => broker.reject(id))

  // --- File-edit approval + checkpoints ---
  ipcMain.handle(CH.editApprove, (_e, id: string) => editBroker.approve(id))
  ipcMain.handle(CH.editReject, (_e, id: string) => editBroker.reject(id))
  ipcMain.handle(CH.checkpointList, () => editBroker.list())
  ipcMain.handle(CH.checkpointUndo, (_e, id: string) => editBroker.undo(id))

  // --- MCP tool approval ---
  ipcMain.handle(CH.toolApprove, (_e, id: string) => toolBroker.approve(id))
  ipcMain.handle(CH.toolConfirmDangerous, (_e, id: string) => toolBroker.confirmDangerous(id))
  ipcMain.handle(CH.toolReject, (_e, id: string) => toolBroker.reject(id))

  // --- Filesystem ---
  ipcMain.handle(CH.fsReadTree, (_e, root?: string) => fsm.readTree(root || appState.projectRoot))
  ipcMain.handle(CH.fsReadFile, (_e, path: string) => fsm.readFile(path))
  ipcMain.handle(CH.fsWriteFile, (_e, path: string, content: string) => fsm.writeFile(path, content))
  ipcMain.handle(CH.appProjectRoot, () => appState.projectRoot)
  ipcMain.handle(CH.appOpenExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url) // http/https only
  })
  ipcMain.handle(CH.clipboardRead, () => clipboard.readText())
  ipcMain.handle(CH.clipboardWrite, (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle(CH.appSetRoot, (_e, root: string) => {
    appState.projectRoot = root
    fsm.watch(root)
    return root
  })
  ipcMain.handle(CH.stateLoad, () => loadState())
  ipcMain.handle(CH.stateSave, (_e, data: unknown) => saveState(data))
  ipcMain.handle(CH.settingsSet, (_e, s: Partial<typeof appState.settings>) => {
    const shellChanged = s.terminalShell != null && s.terminalShell !== appState.settings.terminalShell
    appState.settings = { ...appState.settings, ...s }
    if (shellChanged) executor.respawn()
  })

  // --- MCP ---
  ipcMain.handle(CH.mcpStatus, () => mcpManager.statusList())
  ipcMain.handle(CH.mcpReconnect, () => mcpManager.connectAll())
  ipcMain.handle(CH.mcpConfigPath, () => mcpManager.configPath())
  ipcMain.handle(
    CH.mcpAddServer,
    (_e, name: string, cfg: { command: string; args?: string[]; env?: Record<string, string> }) =>
      mcpManager.addServer(name, cfg)
  )
  ipcMain.handle(CH.gitStatus, () => gitStatus(appState.projectRoot))
  ipcMain.handle(CH.gitHead, (_e, path: string) => gitHead(appState.projectRoot, path))
  ipcMain.handle(CH.gitChanges, () => gitChanges(appState.projectRoot))
  ipcMain.handle(CH.gitStage, (_e, rel: string) => gitStage(appState.projectRoot, rel))
  ipcMain.handle(CH.gitUnstage, (_e, rel: string) => gitUnstage(appState.projectRoot, rel))
  ipcMain.handle(CH.gitCommit, (_e, msg: string) => gitCommit(appState.projectRoot, msg))
  ipcMain.handle(CH.fsListFiles, () => fsm.listFiles(appState.projectRoot))
  ipcMain.handle(CH.fsRepoMap, () => buildRepoMap(fsm, appState.projectRoot))
  ipcMain.handle(CH.fsClassify, (_e, p: string) => fsm.classifyDropped(p))
  ipcMain.handle(CH.fsReadDropped, (_e, p: string) => fsm.readDropped(p))
  ipcMain.handle(CH.fsReadImage, (_e, p: string) => fsm.readImage(p))
  ipcMain.handle(CH.fsPickDir, async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled || !res.filePaths[0]) return appState.projectRoot
    appState.projectRoot = res.filePaths[0]
    fsm.watch(appState.projectRoot)
    return appState.projectRoot
  })
  // Side-effect-free folder picker (does NOT change the project root).
  ipcMain.handle(CH.fsPickFolder, async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled ? '' : res.filePaths[0] || ''
  })
}

app.whenReady().then(() => {
  // Remove the default native menu bar (File/Edit/View/…) — the app has its own
  // in-app File menu, so the native one is redundant.
  Menu.setApplicationMenu(null)
  initServices()
  registerIpc()
  createWindow()
  // Clean up worktree admin state orphaned by a previous crash, then notify the
  // renderer if any *adopted* (unmerged) worktrees are old enough to review.
  worktreeManager
    .pruneOnBoot(appState.projectRoot)
    .then(() => {
      const notice = worktreeManager.staleNotice()
      if (notice) appState.send(CH.worktreeStale, notice)
    })
    .catch(() => {})
  // Start the in-app job scheduler (runs while the app is open).
  scheduler.start().catch((e) => console.warn('[scheduler] start failed:', e))
  // Overlay the live price table in MAIN too, so the spend cap (budget.ts) costs
  // requests with the same rates the renderer shows.
  fetchLivePricing()
    .then((t) => t && Object.keys(t).length && setPriceOverrides(t))
    .catch(() => {})
  ensureAgentConfig().catch(() => {})
  ensureApiConfig().catch(() => {})
  // Connect MCP servers in the background (non-blocking).
  mcpManager.init().catch((e) => {
    console.warn('[mcp] init failed:', e)
    appState.send(CH.appError, `MCP init failed: ${e instanceof Error ? e.message : String(e)}`)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  agents?.killAll()
  fsm?.dispose()
  scheduler?.stop()
  mcpManager.disconnectAll()
  if (process.platform !== 'darwin') app.quit()
})
