import { create } from 'zustand'
import type { Message, PendingCommand, DebateUpdate, PendingEdit, PendingTool } from '@shared/types'
// Attachment is declared below; no shared import needed.

export interface ClaudeSession {
  id: string
  label: string
}

export interface Attachment {
  id: string
  path: string
  name: string
  kind: 'text' | 'image'
  mime?: string
  base64?: string
}

// The subset of state persisted to disk across launches. Excludes live pty
// sessions, command-approval trust (security), and transient context.
export interface PersistedState {
  projectRoot: string
  selectedFile: string | null
  geminiMessages: Message[]
  debateUpdates: DebateUpdate[]
  debatePrompt: string
  geminiModel: string
  claudeModel: string
  claudeEffort: string
  debateRounds: number
  terminalShell: AppState['terminalShell']
  dockLayout: unknown | null
}

interface AppState {
  projectRoot: string
  setProjectRoot: (p: string) => void

  hasGeminiKey: boolean
  setHasGeminiKey: (v: boolean) => void

  // Per-session auto-approval of agent commands.
  trustedSessions: Set<string>
  trustSession: (id: string) => void
  isTrusted: (id: string) => boolean
  clearTrust: () => void

  // User settings (mirrored to main via window.api.settings.set).
  geminiModel: string
  claudeModel: string
  claudeEffort: string
  debateRounds: number
  terminalShell: 'default' | 'powershell' | 'pwsh' | 'cmd' | 'bash' | 'zsh'
  setGeminiModel: (m: string) => void
  setClaudeModel: (m: string) => void
  setClaudeEffort: (e: string) => void
  setDebateRounds: (n: number) => void
  setTerminalShell: (s: AppState['terminalShell']) => void

  pending: PendingCommand[]
  addPending: (c: PendingCommand) => void
  removePending: (id: string) => void

  pendingEdits: PendingEdit[]
  addPendingEdit: (e: PendingEdit) => void
  removePendingEdit: (id: string) => void

  pendingTools: PendingTool[]
  addPendingTool: (t: PendingTool) => void
  removePendingTool: (id: string) => void
  trustedTools: Set<string>
  trustTool: (name: string) => void
  isToolTrusted: (name: string) => boolean

  geminiMessages: Message[]
  addGeminiMessage: (m: Message) => void
  appendToLastGemini: (chunk: string) => void

  claudeSessions: ClaudeSession[]
  activeClaude: string
  addClaudeSession: (s: ClaudeSession) => void
  removeClaudeSession: (id: string) => void
  setActiveClaude: (id: string) => void

  selectedFile: string | null
  setSelectedFile: (path: string | null) => void

  gitStatus: Record<string, string>
  setGitStatus: (m: Record<string, string>) => void

  fileList: string[]
  setFileList: (f: string[]) => void

  openFile: (path: string) => void

  // Persisted dockview layout (panel arrangement).
  dockLayout: unknown | null
  setDockLayout: (l: unknown) => void

  // Files checked in the tree to attach as prompt context.
  contextFiles: Set<string>
  toggleContextFile: (path: string) => void
  clearContextFiles: () => void

  // Assembled file context queued for the next Gemini send (prepended once).
  pendingGeminiContext: string
  setPendingGeminiContext: (s: string) => void

  // Drag-dropped attachments for the next Gemini message.
  attachments: Attachment[]
  addAttachment: (a: Attachment) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void

  // Debate state lives here (not in the view) so it survives minimize/close
  // and a single always-mounted listener accumulates updates.
  debateRunning: boolean
  debateAwaiting: boolean
  debateStatus: string
  debateUpdates: DebateUpdate[]
  debatePrompt: string
  startDebateState: (prompt: string) => void
  addDebateUpdate: (u: DebateUpdate) => void
  setDebateStatus: (s: string) => void
  beginSynthesis: () => void
  endDebate: () => void
  clearDebate: () => void

  hydrate: (d: Partial<PersistedState>) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  projectRoot: '',
  setProjectRoot: (p) => set({ projectRoot: p }),

  hasGeminiKey: false,
  setHasGeminiKey: (v) => set({ hasGeminiKey: v }),

  trustedSessions: new Set(),
  trustSession: (id) =>
    set((s) => ({ trustedSessions: new Set(s.trustedSessions).add(id) })),
  isTrusted: (id) => get().trustedSessions.has(id),
  clearTrust: () => set({ trustedSessions: new Set() }),

  geminiModel: 'gemini-2.5-flash',
  claudeModel: '',
  claudeEffort: '',
  debateRounds: 3,
  terminalShell: 'default',
  setGeminiModel: (m) => set({ geminiModel: m }),
  setClaudeModel: (m) => set({ claudeModel: m }),
  setClaudeEffort: (e) => set({ claudeEffort: e }),
  setDebateRounds: (n) => set({ debateRounds: n }),
  setTerminalShell: (s) => set({ terminalShell: s }),

  pending: [],
  addPending: (c) => set((s) => ({ pending: [...s.pending, c] })),
  removePending: (id) => set((s) => ({ pending: s.pending.filter((p) => p.id !== id) })),

  pendingEdits: [],
  addPendingEdit: (e) => set((s) => ({ pendingEdits: [...s.pendingEdits, e] })),
  removePendingEdit: (id) =>
    set((s) => ({ pendingEdits: s.pendingEdits.filter((e) => e.id !== id) })),

  pendingTools: [],
  addPendingTool: (t) => set((s) => ({ pendingTools: [...s.pendingTools, t] })),
  removePendingTool: (id) => set((s) => ({ pendingTools: s.pendingTools.filter((t) => t.id !== id) })),
  trustedTools: new Set(),
  trustTool: (name) => set((s) => ({ trustedTools: new Set(s.trustedTools).add(name) })),
  isToolTrusted: (name) => get().trustedTools.has(name),

  geminiMessages: [],
  addGeminiMessage: (m) => set((s) => ({ geminiMessages: [...s.geminiMessages, m] })),
  appendToLastGemini: (chunk) =>
    set((s) => {
      const msgs = [...s.geminiMessages]
      const last = msgs[msgs.length - 1]
      if (last && last.role === 'model') {
        msgs[msgs.length - 1] = { ...last, content: last.content + chunk }
      }
      return { geminiMessages: msgs }
    }),

  claudeSessions: [],
  activeClaude: '',
  addClaudeSession: (s) =>
    set((st) => ({ claudeSessions: [...st.claudeSessions, s], activeClaude: s.id })),
  removeClaudeSession: (id) =>
    set((st) => {
      const newSessions = st.claudeSessions.filter(s => s.id !== id)
      return { 
        claudeSessions: newSessions,
        activeClaude: st.activeClaude === id ? (newSessions[0]?.id || '') : st.activeClaude 
      }
    }),
  setActiveClaude: (id) => set({ activeClaude: id }),

  selectedFile: null,
  setSelectedFile: (path) => set({ selectedFile: path }),

  gitStatus: {},
  setGitStatus: (m) => set({ gitStatus: m }),

  fileList: [],
  setFileList: (f) => set({ fileList: f }),

  openFile: (path) => set({ selectedFile: path }),

  dockLayout: null,
  setDockLayout: (l) => set({ dockLayout: l }),

  contextFiles: new Set(),
  toggleContextFile: (path) =>
    set((s) => {
      const next = new Set(s.contextFiles)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { contextFiles: next }
    }),
  clearContextFiles: () => set({ contextFiles: new Set() }),

  pendingGeminiContext: '',
  setPendingGeminiContext: (str) => set({ pendingGeminiContext: str }),

  attachments: [],
  addAttachment: (a) => set((s) => ({ attachments: [...s.attachments, a] })),
  removeAttachment: (id) => set((s) => ({ attachments: s.attachments.filter((x) => x.id !== id) })),
  clearAttachments: () => set({ attachments: [] }),

  debateRunning: false,
  debateAwaiting: false,
  debateStatus: '',
  debateUpdates: [],
  debatePrompt: '',
  startDebateState: (prompt) =>
    set({
      debateRunning: true,
      debateAwaiting: false,
      debateStatus: 'Starting…',
      debateUpdates: [],
      debatePrompt: prompt
    }),
  addDebateUpdate: (u) =>
    set((s) => {
      const ended = u.type === 'synthesis' || u.type === 'error'
      const awaiting = u.type === 'await'
      return {
        debateUpdates: [...s.debateUpdates, u],
        // 'await' pauses for approval; synthesis/error ends the run.
        debateRunning: ended || awaiting ? false : s.debateRunning,
        debateAwaiting: awaiting ? true : ended ? false : s.debateAwaiting,
        debateStatus: ended || awaiting ? '' : s.debateStatus
      }
    }),
  setDebateStatus: (status) => set({ debateStatus: status }),
  beginSynthesis: () => set({ debateAwaiting: false, debateRunning: true, debateStatus: 'Implementing…' }),
  endDebate: () => set({ debateRunning: false, debateAwaiting: false, debateStatus: '' }),
  clearDebate: () =>
    set({
      debateRunning: false,
      debateAwaiting: false,
      debateStatus: '',
      debateUpdates: [],
      debatePrompt: ''
    }),

  hydrate: (d) =>
    set({
      projectRoot: d.projectRoot ?? '',
      selectedFile: d.selectedFile ?? null,
      geminiMessages: d.geminiMessages ?? [],
      debateUpdates: d.debateUpdates ?? [],
      debatePrompt: d.debatePrompt ?? '',
      geminiModel: d.geminiModel ?? 'gemini-2.5-flash',
      claudeModel: d.claudeModel ?? '',
      claudeEffort: d.claudeEffort ?? '',
      debateRounds: d.debateRounds ?? 3,
      terminalShell: d.terminalShell ?? 'default',
      dockLayout: d.dockLayout ?? null,
      debateRunning: false, // never restore a "running" flag — the backend is gone
      debateStatus: ''
    })
}))
