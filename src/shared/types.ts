// Shared types — used by main, preload, and renderer.

export type AgentId = 'claude' | 'gemini'

export interface Message {
  role: 'user' | 'model' | 'assistant'
  content: string
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface GitChange {
  path: string // absolute
  rel: string // relative, forward slashes
  code: string // 2-char porcelain XY
}
export interface GitChanges {
  staged: GitChange[]
  unstaged: GitChange[]
  branch: string
}

export interface DebateUpdate {
  type: 'claude' | 'gemini' | 'synthesis' | 'error'
  text: string
  round?: number
}

export interface DebateRound {
  round: number
  claude: string
  gemini: string
}

// A command parsed from a ```bash run``` block, awaiting user approval.
export interface PendingCommand {
  id: string
  command: string
  origin: AgentId
  sessionId: string
}

export interface CommandResult {
  id: string
  command: string
  output: string
  exitInferred: boolean
}

// Channel name constants — single source of truth for IPC strings.
export const CH = {
  claudeSend: 'claude:send',
  claudeNewSession: 'claude:new-session',
  claudeKillSession: 'claude:kill-session',
  claudeStream: 'claude:stream',
  claudeResize: 'claude:resize',

  geminiSend: 'gemini:send',
  geminiSideSend: 'gemini:side-send',
  geminiStream: 'gemini:stream',
  geminiHasKey: 'gemini:has-key',
  geminiSaveKey: 'gemini:save-key',

  debateStart: 'debate:start',
  debateUpdate: 'debate:update',
  debateStatus: 'debate:status',

  terminalInput: 'terminal:input',
  terminalOutput: 'terminal:output',
  terminalResize: 'terminal:resize',

  cmdPending: 'cmd:pending',
  cmdApprove: 'cmd:approve',
  cmdReject: 'cmd:reject',
  cmdResult: 'cmd:result',

  fsReadTree: 'fs:read-tree',
  fsReadFile: 'fs:read-file',
  fsWriteFile: 'fs:write-file',
  fsPickDir: 'fs:pick-dir',
  fsChanged: 'fs:changed',
  fsListFiles: 'fs:list-files',
  gitStatus: 'git:status',
  gitHead: 'git:head',
  gitChanges: 'git:changes',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',

  appProjectRoot: 'app:project-root',
  appSetRoot: 'app:set-root',
  stateLoad: 'state:load',
  stateSave: 'state:save'
} as const
