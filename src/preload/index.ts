import { contextBridge, ipcRenderer } from 'electron'
import {
  CH,
  type Message,
  type FileNode,
  type PendingCommand,
  type CommandResult,
  type DebateUpdate,
  type DebateAgent,
  type PipelineStep,
  type PipelineUpdate,
  type GitChanges,
  type PendingEdit,
  type PendingTool,
  type Checkpoint,
  type AgentDef,
  type ApiProvider,
  type WorktreeInfo,
  type WorktreePrResult,
  type WorktreeStats,
  type RunInfo,
  type ScheduledJob
} from '../shared/types'

interface EditResult {
  id: string
  rel: string
  outcome: string
}

// The only surface the renderer can touch. No nodeIntegration, no raw ipc.
const api = {
  agent: {
    list: (): Promise<AgentDef[]> => ipcRenderer.invoke(CH.agentList),
    save: (def: AgentDef): Promise<AgentDef[]> => ipcRenderer.invoke(CH.agentSave, def),
    remove: (id: string): Promise<AgentDef[]> => ipcRenderer.invoke(CH.agentRemove, id),
    newSession: (sessionId: string, agentId: string, cwd?: string): Promise<string> =>
      ipcRenderer.invoke(CH.agentNewSession, sessionId, agentId, cwd),
    send: (sessionId: string, text: string): Promise<void> =>
      ipcRenderer.invoke(CH.agentSend, sessionId, text),
    write: (sessionId: string, data: string): void =>
      ipcRenderer.send(CH.agentInput, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ipcRenderer.send(CH.agentResize, sessionId, cols, rows),
    kill: (sessionId: string): Promise<void> => ipcRenderer.invoke(CH.agentKillSession, sessionId),
    onStream: (cb: (sessionId: string, data: string) => void): (() => void) => {
      const h = (_e: unknown, sessionId: string, data: string): void => cb(sessionId, data)
      ipcRenderer.on(CH.agentStream, h)
      return () => ipcRenderer.removeListener(CH.agentStream, h)
    }
  },
  gemini: {
    send: (
      prompt: string,
      history: Message[],
      images?: { mime: string; base64: string }[]
    ): Promise<string> => ipcRenderer.invoke(CH.geminiSend, prompt, history, images),
    sideSend: (prompt: string): Promise<string> =>
      ipcRenderer.invoke(CH.geminiSideSend, prompt),
    hasKey: (): Promise<boolean> => ipcRenderer.invoke(CH.geminiHasKey),
    saveKey: (key: string): Promise<void> => ipcRenderer.invoke(CH.geminiSaveKey, key),
    listModels: (): Promise<string[]> => ipcRenderer.invoke(CH.geminiListModels),
    onStream: (cb: (chunk: string) => void): (() => void) => {
      const h = (_e: unknown, chunk: string): void => cb(chunk)
      ipcRenderer.on(CH.geminiStream, h)
      return () => ipcRenderer.removeListener(CH.geminiStream, h)
    }
  },
  claude: {
    listModels: (): Promise<{
      models: { value: string; label: string }[]
      effort: { value: string; label: string }[]
    }> => ipcRenderer.invoke(CH.claudeListModels)
  },
  debate: {
    agents: (): Promise<DebateAgent[]> => ipcRenderer.invoke(CH.debateAgents),
    start: (prompt: string, participantIds?: string[], synthesizerId?: string): Promise<void> =>
      ipcRenderer.invoke(CH.debateStart, prompt, participantIds, synthesizerId),
    synthesize: (): Promise<void> => ipcRenderer.invoke(CH.debateSynthesize),
    decline: (): Promise<void> => ipcRenderer.invoke(CH.debateDecline),
    cancel: (): Promise<void> => ipcRenderer.invoke(CH.debateCancel),
    onUpdate: (cb: (u: DebateUpdate) => void): (() => void) => {
      const h = (_e: unknown, u: DebateUpdate): void => cb(u)
      ipcRenderer.on(CH.debateUpdate, h)
      return () => ipcRenderer.removeListener(CH.debateUpdate, h)
    },
    onStatus: (cb: (s: string) => void): (() => void) => {
      const h = (_e: unknown, s: string): void => cb(s)
      ipcRenderer.on(CH.debateStatus, h)
      return () => ipcRenderer.removeListener(CH.debateStatus, h)
    }
  },
  pipeline: {
    run: (steps: PipelineStep[], input: string, dryRun?: boolean, allowFull?: boolean): Promise<string> =>
      ipcRenderer.invoke(CH.pipelineRun, steps, input, dryRun, allowFull),
    cancel: (runId: string): Promise<void> => ipcRenderer.invoke(CH.pipelineCancel, runId),
    runs: (): Promise<RunInfo[]> => ipcRenderer.invoke(CH.pipelineRuns),
    clearRuns: (): Promise<void> => ipcRenderer.invoke(CH.pipelineClearRuns),
    onUpdate: (cb: (u: PipelineUpdate) => void): (() => void) => {
      const h = (_e: unknown, u: PipelineUpdate): void => cb(u)
      ipcRenderer.on(CH.pipelineUpdate, h)
      return () => ipcRenderer.removeListener(CH.pipelineUpdate, h)
    },
    onComplete: (cb: (run: RunInfo) => void): (() => void) => {
      const h = (_e: unknown, run: RunInfo): void => cb(run)
      ipcRenderer.on(CH.runComplete, h)
      return () => ipcRenderer.removeListener(CH.runComplete, h)
    }
  },
  terminal: {
    input: (data: string): void => ipcRenderer.send(CH.terminalInput, data),
    resize: (cols: number, rows: number): void => ipcRenderer.send(CH.terminalResize, cols, rows),
    onOutput: (cb: (data: string) => void): (() => void) => {
      const h = (_e: unknown, data: string): void => cb(data)
      ipcRenderer.on(CH.terminalOutput, h)
      return () => ipcRenderer.removeListener(CH.terminalOutput, h)
    }
  },
  command: {
    // Every call must echo the nonce that arrived on the PendingCommand payload
    // (onPending) — main verifies it before acting. See SECURITY.md / CommandBroker.
    approve: (id: string, nonce: string): Promise<void> => ipcRenderer.invoke(CH.cmdApprove, id, nonce),
    confirmDangerous: (id: string, nonce: string): Promise<void> =>
      ipcRenderer.invoke(CH.cmdConfirmDangerous, id, nonce),
    reject: (id: string, nonce: string): Promise<void> => ipcRenderer.invoke(CH.cmdReject, id, nonce),
    onPending: (cb: (c: PendingCommand) => void): (() => void) => {
      const h = (_e: unknown, c: PendingCommand): void => cb(c)
      ipcRenderer.on(CH.cmdPending, h)
      return () => ipcRenderer.removeListener(CH.cmdPending, h)
    },
    onResult: (cb: (r: CommandResult) => void): (() => void) => {
      const h = (_e: unknown, r: CommandResult): void => cb(r)
      ipcRenderer.on(CH.cmdResult, h)
      return () => ipcRenderer.removeListener(CH.cmdResult, h)
    }
  },
  fs: {
    readTree: (root?: string): Promise<FileNode> => ipcRenderer.invoke(CH.fsReadTree, root),
    readFile: (path: string): Promise<string> => ipcRenderer.invoke(CH.fsReadFile, path),
    listFiles: (): Promise<string[]> => ipcRenderer.invoke(CH.fsListFiles),
    repoMap: (): Promise<string> => ipcRenderer.invoke(CH.fsRepoMap),
    classify: (p: string): Promise<{ kind: 'dir' | 'image' | 'text'; name: string }> =>
      ipcRenderer.invoke(CH.fsClassify, p),
    readDropped: (p: string): Promise<string> => ipcRenderer.invoke(CH.fsReadDropped, p),
    readImage: (p: string): Promise<{ mime: string; base64: string }> =>
      ipcRenderer.invoke(CH.fsReadImage, p),
    writeFile: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke(CH.fsWriteFile, path, content),
    pickDir: (): Promise<string> => ipcRenderer.invoke(CH.fsPickDir),
    pickFolder: (): Promise<string> => ipcRenderer.invoke(CH.fsPickFolder),
    projectRoot: (): Promise<string> => ipcRenderer.invoke(CH.appProjectRoot),
    onChanged: (cb: (root: string) => void): (() => void) => {
      const h = (_e: unknown, root: string): void => cb(root)
      ipcRenderer.on(CH.fsChanged, h)
      return () => ipcRenderer.removeListener(CH.fsChanged, h)
    }
  },
  edit: {
    // Nonce echoed from the PendingEdit payload (onPending) — see command.* above.
    approve: (id: string, nonce: string): Promise<void> => ipcRenderer.invoke(CH.editApprove, id, nonce),
    reject: (id: string, nonce: string): Promise<void> => ipcRenderer.invoke(CH.editReject, id, nonce),
    onPending: (cb: (e: PendingEdit) => void): (() => void) => {
      const h = (_e: unknown, e: PendingEdit): void => cb(e)
      ipcRenderer.on(CH.editPending, h)
      return () => ipcRenderer.removeListener(CH.editPending, h)
    },
    onResult: (cb: (r: EditResult) => void): (() => void) => {
      const h = (_e: unknown, r: EditResult): void => cb(r)
      ipcRenderer.on(CH.editResult, h)
      return () => ipcRenderer.removeListener(CH.editResult, h)
    }
  },
  tool: {
    // Nonce echoed from the PendingTool payload (onPending) — see command.* above.
    approve: (id: string, nonce: string): Promise<void> => ipcRenderer.invoke(CH.toolApprove, id, nonce),
    confirmDangerous: (id: string, nonce: string): Promise<void> =>
      ipcRenderer.invoke(CH.toolConfirmDangerous, id, nonce),
    reject: (id: string, nonce: string): Promise<void> => ipcRenderer.invoke(CH.toolReject, id, nonce),
    onPending: (cb: (t: PendingTool) => void): (() => void) => {
      const h = (_e: unknown, t: PendingTool): void => cb(t)
      ipcRenderer.on(CH.toolPending, h)
      return () => ipcRenderer.removeListener(CH.toolPending, h)
    }
  },
  checkpoint: {
    list: (): Promise<Checkpoint[]> => ipcRenderer.invoke(CH.checkpointList),
    undo: (id: string): Promise<void> => ipcRenderer.invoke(CH.checkpointUndo, id),
    onChanged: (cb: () => void): (() => void) => {
      const h = (): void => cb()
      ipcRenderer.on(CH.checkpointChanged, h)
      return () => ipcRenderer.removeListener(CH.checkpointChanged, h)
    }
  },
  git: {
    status: (): Promise<Record<string, string>> => ipcRenderer.invoke(CH.gitStatus),
    head: (path: string): Promise<string | null> => ipcRenderer.invoke(CH.gitHead, path),
    changes: (): Promise<GitChanges> => ipcRenderer.invoke(CH.gitChanges),
    stage: (rel: string): Promise<void> => ipcRenderer.invoke(CH.gitStage, rel),
    unstage: (rel: string): Promise<void> => ipcRenderer.invoke(CH.gitUnstage, rel),
    commit: (msg: string): Promise<string> => ipcRenderer.invoke(CH.gitCommit, msg)
  },
  state: {
    load: (): Promise<unknown | null> => ipcRenderer.invoke(CH.stateLoad),
    save: (data: unknown): Promise<void> => ipcRenderer.invoke(CH.stateSave, data),
    setRoot: (root: string): Promise<string> => ipcRenderer.invoke(CH.appSetRoot, root)
  },
  settings: {
    set: (s: {
      geminiModel?: string
      claudeModel?: string
      claudeEffort?: string
      debateRounds?: number
      terminalShell?: 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh'
      isolateAgents?: boolean
      costCap?: number
      allowSecretReads?: boolean
      allowProtectedWrites?: boolean
      pipelineAllowFullDefault?: boolean
      autonomousAllow?: string
      closeToTray?: boolean
    }): Promise<void> => ipcRenderer.invoke(CH.settingsSet, s)
  },
  jobs: {
    list: (): Promise<ScheduledJob[]> => ipcRenderer.invoke(CH.jobList),
    save: (job: ScheduledJob): Promise<ScheduledJob[]> => ipcRenderer.invoke(CH.jobSave, job),
    remove: (id: string): Promise<ScheduledJob[]> => ipcRenderer.invoke(CH.jobRemove, id),
    runNow: (id: string): Promise<string> => ipcRenderer.invoke(CH.jobRunNow, id),
    onChanged: (cb: () => void): (() => void) => {
      const h = (): void => cb()
      ipcRenderer.on(CH.jobsChanged, h)
      return () => ipcRenderer.removeListener(CH.jobsChanged, h)
    }
  },
  worktree: {
    list: (): Promise<WorktreeInfo[]> => ipcRenderer.invoke(CH.worktreeList),
    diff: (sessionId: string): Promise<string> => ipcRenderer.invoke(CH.worktreeDiff, sessionId),
    remove: (sessionId: string, mode: 'merge' | 'discard'): Promise<string> =>
      ipcRenderer.invoke(CH.worktreeRemove, sessionId, mode),
    createPr: (sessionId: string): Promise<WorktreePrResult> => ipcRenderer.invoke(CH.worktreeCreatePr, sessionId),
    stats: (sessionId: string): Promise<WorktreeStats | null> => ipcRenderer.invoke(CH.worktreeStats, sessionId),
    onChanged: (cb: () => void): (() => void) => {
      const h = (): void => cb()
      ipcRenderer.on(CH.worktreeChanged, h)
      return () => ipcRenderer.removeListener(CH.worktreeChanged, h)
    }
  },
  openExternal: (url: string): void => {
    ipcRenderer.invoke(CH.appOpenExternal, url)
  },
  api: {
    providers: (): Promise<ApiProvider[]> => ipcRenderer.invoke(CH.apiProvidersList),
    saveProvider: (p: ApiProvider): Promise<ApiProvider[]> => ipcRenderer.invoke(CH.apiProviderSave, p),
    removeProvider: (id: string): Promise<ApiProvider[]> => ipcRenderer.invoke(CH.apiProviderRemove, id),
    hasKey: (id: string): Promise<boolean> => ipcRenderer.invoke(CH.apiHasKey, id),
    saveKey: (id: string, key: string): Promise<void> => ipcRenderer.invoke(CH.apiSaveKey, id, key),
    send: (instanceId: string, providerId: string, model: string, history: Message[]): Promise<void> =>
      ipcRenderer.invoke(CH.apiSend, instanceId, providerId, model, history),
    onStream: (cb: (instanceId: string, chunk: string) => void): (() => void) => {
      const h = (_e: unknown, instanceId: string, chunk: string): void => cb(instanceId, chunk)
      ipcRenderer.on(CH.apiStream, h)
      return () => ipcRenderer.removeListener(CH.apiStream, h)
    }
  },
  clipboard: {
    read: (): Promise<string> => ipcRenderer.invoke(CH.clipboardRead),
    write: (text: string): Promise<void> => ipcRenderer.invoke(CH.clipboardWrite, text)
  },
  pricingLive: (): Promise<Record<string, { in: number; out: number }>> => ipcRenderer.invoke(CH.pricingLive),
  onAppError: (cb: (message: string) => void): (() => void) => {
    const h = (_e: unknown, message: string): void => cb(message)
    ipcRenderer.on(CH.appError, h)
    return () => ipcRenderer.removeListener(CH.appError, h)
  },
  onWorktreeStale: (cb: (notice: import('@shared/types').WorktreeStaleNotice) => void): (() => void) => {
    const h = (_e: unknown, notice: import('@shared/types').WorktreeStaleNotice): void => cb(notice)
    ipcRenderer.on(CH.worktreeStale, h)
    return () => ipcRenderer.removeListener(CH.worktreeStale, h)
  },
  onUsage: (cb: (id: string, usage: { promptTokens: number; completionTokens: number }) => void): (() => void) => {
    const h = (_e: unknown, id: string, usage: { promptTokens: number; completionTokens: number }): void =>
      cb(id, usage)
    ipcRenderer.on(CH.usage, h)
    return () => ipcRenderer.removeListener(CH.usage, h)
  },
  mcp: {
    status: (): Promise<{ server: string; connected: boolean; toolCount: number; error?: string }[]> =>
      ipcRenderer.invoke(CH.mcpStatus),
    reconnect: (): Promise<{ server: string; connected: boolean; toolCount: number; error?: string }[]> =>
      ipcRenderer.invoke(CH.mcpReconnect),
    configPath: (): Promise<string> => ipcRenderer.invoke(CH.mcpConfigPath),
    addServer: (
      name: string,
      cfg: { command: string; args?: string[]; env?: Record<string, string> }
    ): Promise<{ server: string; connected: boolean; toolCount: number; error?: string }[]> =>
      ipcRenderer.invoke(CH.mcpAddServer, name, cfg)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
