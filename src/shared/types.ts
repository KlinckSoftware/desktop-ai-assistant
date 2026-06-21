// Shared types — used by main, preload, and renderer.

// Origin of a proposed command/edit/tool call (agentic loops + Claude pty).
export type AgentId = 'claude' | 'gemini' | 'api'

// A pluggable CLI agent definition (Claude Code, Gemini CLI, Aider, Codex, …).
// Built-in defaults are merged with a user-editable agents.json.
export interface AgentDef {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  installHint?: string // shown in the setup window when the command isn't found
  docsUrl?: string
  builtin?: boolean // built-in (can be overridden but not deleted)
  available?: boolean // computed: command resolves on PATH
}

// A running (or requested) CLI agent session.
export interface AgentSession {
  id: string
  agentId: string
  label: string
  cwd: string
}

// An OpenAI-compatible API provider (OpenAI, Groq, Mistral, OpenRouter, Ollama…).
export interface ApiProvider {
  id: string
  name: string
  baseUrl: string // up to /v1; we POST {baseUrl}/chat/completions
  defaultModel: string
  models?: string[] // suggested model ids for the panel dropdown (free-text still allowed)
  docsUrl?: string
  noKey?: boolean // local providers (e.g. Ollama) need no API key
  builtin?: boolean
  hasKey?: boolean // computed
}

export interface Message {
  role: 'user' | 'model' | 'assistant'
  content: string
}

// Provider-reported token usage for one request (summed across agentic turns).
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
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
  type: 'turn' | 'synthesis' | 'error' | 'await'
  text: string
  round?: number
  side?: 'a' | 'b' // which participant produced this turn
  name?: string // participant display name
}

export interface DebateRound {
  round: number
  a: string
  b: string
}

// A model/agent that can act as a debate participant — only those currently
// usable by this user (CLI binary on PATH, or API key present). id forms:
// 'claude', 'gemini', or 'api:<providerId>'.
export interface DebateAgent {
  id: string
  name: string
  kind: 'claude' | 'gemini' | 'api'
}

// A saved agent pipeline: a prompt is fed through each step in order, each
// step's output becoming the next step's input (optionally wrapped by the
// step's instruction). agentId uses the DebateAgent id form.
export interface PipelineStep {
  agentId: string
  instruction?: string // optional per-step framing prepended to the carried text
}
export interface Pipeline {
  id: string
  name: string
  steps: PipelineStep[]
}

// Streamed result of one pipeline step.
export interface PipelineUpdate {
  type: 'step' | 'error' | 'done'
  index?: number
  agentId?: string
  name?: string
  text?: string
}

// A command parsed from a ```bash run``` block, awaiting user approval.
export interface PendingCommand {
  id: string
  command: string
  origin: AgentId
  sessionId: string
}

// A file write proposed by an agent (```file <path>``` block), awaiting approval.
export interface PendingEdit {
  id: string
  path: string // absolute
  rel: string // relative to project root
  oldContent: string
  newContent: string
  isNew: boolean
  origin: AgentId
}

// An MCP tool call proposed by the model, awaiting approval.
export interface PendingTool {
  id: string
  tool: string // qualified server__tool
  argsPreview: string // pretty JSON of arguments
}

export interface Checkpoint {
  id: string
  rel: string
  path: string
  ts: number // epoch ms, stamped in renderer
  label: string
}

export interface CommandResult {
  id: string
  command: string
  output: string
  exitInferred: boolean
}

// Channel name constants — single source of truth for IPC strings.
export const CH = {
  // Generic CLI-agent sessions (Claude, Gemini CLI, Aider, Codex, …).
  agentList: 'agent:list',
  agentSave: 'agent:save',
  agentRemove: 'agent:remove',
  agentNewSession: 'agent:new-session',
  agentSend: 'agent:send',
  agentInput: 'agent:input',
  agentKillSession: 'agent:kill-session',
  agentStream: 'agent:stream',
  agentResize: 'agent:resize',

  // Generic OpenAI-compatible API chat agents.
  apiProvidersList: 'api:providers-list',
  apiProviderSave: 'api:provider-save',
  apiProviderRemove: 'api:provider-remove',
  apiHasKey: 'api:has-key',
  apiSaveKey: 'api:save-key',
  apiSend: 'api:send',
  apiStream: 'api:stream',
  usage: 'usage:update', // (id, { promptTokens, completionTokens }) provider-reported
  pricingLive: 'pricing:live', // -> live model price table (LiteLLM), per-1M in/out

  geminiSend: 'gemini:send',
  geminiSideSend: 'gemini:side-send',
  geminiStream: 'gemini:stream',
  geminiHasKey: 'gemini:has-key',
  geminiSaveKey: 'gemini:save-key',

  debateStart: 'debate:start',
  debateAgents: 'debate:agents',
  debateUpdate: 'debate:update',
  debateStatus: 'debate:status',
  debateSynthesize: 'debate:synthesize',
  debateDecline: 'debate:decline',

  pipelineRun: 'pipeline:run',
  pipelineUpdate: 'pipeline:update',

  terminalInput: 'terminal:input',
  terminalOutput: 'terminal:output',
  terminalResize: 'terminal:resize',

  cmdPending: 'cmd:pending',
  cmdApprove: 'cmd:approve',
  cmdReject: 'cmd:reject',
  cmdResult: 'cmd:result',

  editPending: 'edit:pending',
  editApprove: 'edit:approve',
  editReject: 'edit:reject',
  editResult: 'edit:result',

  toolPending: 'tool:pending',
  toolApprove: 'tool:approve',
  toolReject: 'tool:reject',
  toolResult: 'tool:result',

  checkpointList: 'checkpoint:list',
  checkpointUndo: 'checkpoint:undo',
  checkpointChanged: 'checkpoint:changed',

  fsReadTree: 'fs:read-tree',
  fsReadFile: 'fs:read-file',
  fsWriteFile: 'fs:write-file',
  fsPickDir: 'fs:pick-dir',
  fsPickFolder: 'fs:pick-folder',
  fsChanged: 'fs:changed',
  fsListFiles: 'fs:list-files',
  fsRepoMap: 'fs:repo-map',
  fsClassify: 'fs:classify',
  fsReadDropped: 'fs:read-dropped',
  fsReadImage: 'fs:read-image',
  gitStatus: 'git:status',
  gitHead: 'git:head',
  gitChanges: 'git:changes',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitCommit: 'git:commit',

  appProjectRoot: 'app:project-root',
  appSetRoot: 'app:set-root',
  appOpenExternal: 'app:open-external',
  clipboardRead: 'app:clipboard-read',
  clipboardWrite: 'app:clipboard-write',
  stateLoad: 'state:load',
  stateSave: 'state:save',
  settingsSet: 'settings:set',

  mcpStatus: 'mcp:status',
  mcpReconnect: 'mcp:reconnect',
  mcpConfigPath: 'mcp:config-path'
} as const
