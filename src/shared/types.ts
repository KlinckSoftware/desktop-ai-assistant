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
  id?: string // stable ref for deps/${id} interpolation; auto-assigned if missing
  agentId: string
  instruction?: string // optional per-step framing prepended to the carried text
  permission?: 'read-only' | 'edit' | 'full' // tool capability for this step (default read-only)
  model?: string // per-step model override (else the participant's default)
  effort?: string // per-step reasoning effort (Claude steps only)
  // DAG: ids of steps whose outputs feed this one. Missing/empty => the previous
  // step (linear back-compat). Outputs are also addressable as ${id} / ${input}
  // inside `instruction`. Execution stays sequential in topological order.
  deps?: string[]
  // Skip this step unless `from` (a dep id; else the combined input) contains
  // `contains` (case-insensitive). Lets a step run conditionally on a prior result.
  condition?: { contains: string; from?: string }
  // Map step: split the resolved input into items (one per non-empty line) and run
  // the instruction once per item, sequentially; the output is the joined results.
  map?: boolean
}
export interface Pipeline {
  id: string
  name: string
  steps: PipelineStep[]
}

// Streamed result of one pipeline step. `runId` ties updates to a specific run
// (RunManager) so the renderer can route concurrent/background runs correctly.
export interface PipelineUpdate {
  type: 'queued' | 'started' | 'step' | 'error' | 'done'
  runId?: string
  index?: number
  agentId?: string
  name?: string
  text?: string
}

// Main-owned record of a pipeline run (active or recent), so a reopened panel
// can show in-flight runs and history survives the panel being closed.
export interface RunInfo {
  id: string
  ts: number
  input: string
  dryRun: boolean
  allowFull?: boolean // run opted into autonomous shell for `full` steps
  label: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  steps: PipelineStep[]
  updates: PipelineUpdate[]
}

// A completed pipeline run, kept in history so it can be reviewed / re-run.
export interface PipelineRun {
  id: string
  ts: number // epoch ms
  input: string
  dryRun: boolean
  steps: PipelineStep[]
  updates: PipelineUpdate[]
}

// A scheduled pipeline job. Runs unattended via RunManager (pipeline steps are
// always autonomous, never interactive), while the app is open. `steps` is a
// snapshot of a saved pipeline so the job is stable if the pipeline is edited.
export type JobTrigger =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string } // local 'HH:MM'
  | { kind: 'git' } // on project file change (debounced)

export interface ScheduledJob {
  id: string
  name: string
  steps: PipelineStep[]
  input: string
  trigger: JobTrigger
  enabled: boolean
  allowFull?: boolean // opt this unattended job into autonomous shell (full steps)
  lastRun?: number // epoch ms
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

// An isolated git worktree backing an agent session or pipeline run. Surfaced to
// the renderer so the user can review (diff) and merge/discard a session's work.
export interface WorktreeInfo {
  sessionId: string
  path: string
  branch: string
  base: string
  kind: 'agent' | 'pipeline'
  label?: string // human label (agent name / pipeline name) when known
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
  geminiListModels: 'gemini:list-models',

  debateStart: 'debate:start',
  debateAgents: 'debate:agents',
  debateUpdate: 'debate:update',
  debateStatus: 'debate:status',
  debateSynthesize: 'debate:synthesize',
  debateDecline: 'debate:decline',
  debateCancel: 'debate:cancel',

  pipelineRun: 'pipeline:run', // (steps, input, dryRun) -> runId
  pipelineUpdate: 'pipeline:update', // runId-tagged step/status updates
  pipelineCancel: 'pipeline:cancel', // (runId)
  pipelineRuns: 'pipeline:runs', // -> RunInfo[] (active + recent), for panel mount
  pipelineClearRuns: 'pipeline:clear-runs', // wipe recorded runs (privacy)
  runComplete: 'run:complete', // (RunInfo) a run finished — for toast/notify

  // Scheduled jobs (in-app scheduler).
  jobList: 'job:list',
  jobSave: 'job:save', // (ScheduledJob) add or update -> ScheduledJob[]
  jobRemove: 'job:remove', // (id) -> ScheduledJob[]
  jobRunNow: 'job:run-now', // (id) -> runId
  jobsChanged: 'job:changed', // event: jobs list changed (e.g. lastRun updated)

  terminalInput: 'terminal:input',
  terminalOutput: 'terminal:output',
  terminalResize: 'terminal:resize',

  cmdPending: 'cmd:pending',
  cmdApprove: 'cmd:approve',
  cmdConfirmDangerous: 'cmd:confirm-dangerous',
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

  appError: 'app:error', // (message) background failures surfaced as a toast
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
  mcpConfigPath: 'mcp:config-path',
  mcpAddServer: 'mcp:add-server',

  // Agent isolation: list active worktrees, review a diff, merge/discard one.
  worktreeList: 'worktree:list',
  worktreeDiff: 'worktree:diff',
  worktreeRemove: 'worktree:remove', // (sessionId, 'merge' | 'discard') -> status
  worktreeChanged: 'worktree:changed' // event: the set/state of worktrees changed
} as const
