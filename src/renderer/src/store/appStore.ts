import { create } from 'zustand'
import type { Message, PendingCommand, DebateUpdate } from '@shared/types'

export interface ClaudeSession {
  id: string
  label: string
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

  pending: PendingCommand[]
  addPending: (c: PendingCommand) => void
  removePending: (id: string) => void

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

  // Debate state lives here (not in the view) so it survives minimize/close
  // and a single always-mounted listener accumulates updates.
  debateRunning: boolean
  debateStatus: string
  debateUpdates: DebateUpdate[]
  debatePrompt: string
  startDebateState: (prompt: string) => void
  addDebateUpdate: (u: DebateUpdate) => void
  setDebateStatus: (s: string) => void
  endDebate: () => void
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

  pending: [],
  addPending: (c) => set((s) => ({ pending: [...s.pending, c] })),
  removePending: (id) => set((s) => ({ pending: s.pending.filter((p) => p.id !== id) })),

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

  debateRunning: false,
  debateStatus: '',
  debateUpdates: [],
  debatePrompt: '',
  startDebateState: (prompt) =>
    set({ debateRunning: true, debateStatus: 'Starting…', debateUpdates: [], debatePrompt: prompt }),
  addDebateUpdate: (u) =>
    set((s) => ({
      debateUpdates: [...s.debateUpdates, u],
      // Synthesis or error ends the run.
      debateRunning: u.type === 'synthesis' || u.type === 'error' ? false : s.debateRunning,
      debateStatus: u.type === 'synthesis' || u.type === 'error' ? '' : s.debateStatus
    })),
  setDebateStatus: (status) => set({ debateStatus: status }),
  endDebate: () => set({ debateRunning: false, debateStatus: '' })
}))
