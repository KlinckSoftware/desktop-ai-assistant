import { contextBridge, ipcRenderer } from 'electron'
import {
  CH,
  type Message,
  type FileNode,
  type PendingCommand,
  type CommandResult,
  type DebateUpdate
} from '../shared/types'

// The only surface the renderer can touch. No nodeIntegration, no raw ipc.
const api = {
  claude: {
    newSession: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke(CH.claudeNewSession, sessionId),
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
    send: (prompt: string, history: Message[]): Promise<string> =>
      ipcRenderer.invoke(CH.geminiSend, prompt, history),
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
    writeFile: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke(CH.fsWriteFile, path, content),
    pickDir: (): Promise<string> => ipcRenderer.invoke(CH.fsPickDir),
    projectRoot: (): Promise<string> => ipcRenderer.invoke(CH.appProjectRoot),
    onChanged: (cb: (root: string) => void): (() => void) => {
      const h = (_e: unknown, root: string): void => cb(root)
      ipcRenderer.on(CH.fsChanged, h)
      return () => ipcRenderer.removeListener(CH.fsChanged, h)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
