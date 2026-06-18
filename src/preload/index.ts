import { contextBridge, ipcRenderer } from 'electron'
import {
  CH,
  type Message,
  type FileNode,
  type PendingCommand,
  type CommandResult,
  type DebateUpdate,
  type GitChanges,
  type PendingEdit,
  type PendingTool,
  type Checkpoint
} from '../shared/types'

interface EditResult {
  id: string
  rel: string
  outcome: string
}

// The only surface the renderer can touch. No nodeIntegration, no raw ipc.
const api = {
  claude: {
    newSession: (sessionId: string, cwd?: string): Promise<string> =>
      ipcRenderer.invoke(CH.claudeNewSession, sessionId, cwd),
    send: (sessionId: string, text: string): Promise<void> =>
      ipcRenderer.invoke(CH.claudeSend, sessionId, text),
    write: (sessionId: string, data: string): void =>
      ipcRenderer.send(CH.claudeStream, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number): void =>
      ipcRenderer.send(CH.claudeResize, sessionId, cols, rows),
    kill: (sessionId: string): Promise<void> => ipcRenderer.invoke(CH.claudeKillSession, sessionId),
    onStream: (cb: (sessionId: string, data: string) => void): (() => void) => {
      const h = (_e: unknown, sessionId: string, data: string): void => cb(sessionId, data)
      ipcRenderer.on(CH.claudeStream, h)
      return () => ipcRenderer.removeListener(CH.claudeStream, h)
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
    onStream: (cb: (chunk: string) => void): (() => void) => {
      const h = (_e: unknown, chunk: string): void => cb(chunk)
      ipcRenderer.on(CH.geminiStream, h)
      return () => ipcRenderer.removeListener(CH.geminiStream, h)
    }
  },
  debate: {
    start: (prompt: string): Promise<void> => ipcRenderer.invoke(CH.debateStart, prompt),
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
    approve: (id: string): Promise<void> => ipcRenderer.invoke(CH.cmdApprove, id),
    reject: (id: string): Promise<void> => ipcRenderer.invoke(CH.cmdReject, id),
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
    approve: (id: string): Promise<void> => ipcRenderer.invoke(CH.editApprove, id),
    reject: (id: string): Promise<void> => ipcRenderer.invoke(CH.editReject, id),
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
    approve: (id: string): Promise<void> => ipcRenderer.invoke(CH.toolApprove, id),
    reject: (id: string): Promise<void> => ipcRenderer.invoke(CH.toolReject, id),
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
      debateRounds?: number
      terminalShell?: 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh'
    }): Promise<void> => ipcRenderer.invoke(CH.settingsSet, s)
  },
  mcp: {
    status: (): Promise<{ server: string; connected: boolean; toolCount: number; error?: string }[]> =>
      ipcRenderer.invoke(CH.mcpStatus),
    reconnect: (): Promise<{ server: string; connected: boolean; toolCount: number; error?: string }[]> =>
      ipcRenderer.invoke(CH.mcpReconnect),
    configPath: (): Promise<string> => ipcRenderer.invoke(CH.mcpConfigPath)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
