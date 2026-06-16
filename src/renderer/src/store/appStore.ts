import { create } from 'zustand'
import type { Message, PendingCommand } from '@shared/types'

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
  setActiveClaude: (id: string) => void
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
  setActiveClaude: (id) => set({ activeClaude: id })
}))
