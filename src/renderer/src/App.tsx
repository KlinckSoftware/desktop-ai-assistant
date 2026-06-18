import { useEffect, useState } from 'react'
import { Allotment } from 'allotment'
import { checkDangerous } from '@shared/dangerousCommand'
import { useAppStore } from './store/appStore'
import ClaudePane from './panes/ClaudePane'
import GeminiChat from './panes/GeminiChat'
import TerminalPane from './panes/TerminalPane'
import FileTreePanel from './panes/FileTreePanel'
import DebateView from './panes/DebateView'
import GitPanel from './panes/GitPanel'
import CheckpointsPanel from './panes/CheckpointsPanel'
import CommandToast from './components/CommandToast'
import EditReview from './components/EditReview'
import SettingsModal from './components/SettingsModal'
import FileMenu from './components/FileMenu'
import SessionSidebar from './components/SessionSidebar'
import SideChat from './components/SideChat'
import DiffViewer from './panes/DiffViewer'

export default function App(): JSX.Element {
  const setProjectRoot = useAppStore((s) => s.setProjectRoot)
  const setHasGeminiKey = useAppStore((s) => s.setHasGeminiKey)
  const hasGeminiKey = useAppStore((s) => s.hasGeminiKey)
  const addPending = useAppStore((s) => s.addPending)
  const addPendingEdit = useAppStore((s) => s.addPendingEdit)
  const removePendingEdit = useAppStore((s) => s.removePendingEdit)
  const hydrate = useAppStore((s) => s.hydrate)
  const addDebateUpdate = useAppStore((s) => s.addDebateUpdate)
  const setDebateStatus = useAppStore((s) => s.setDebateStatus)
  const debateRunning = useAppStore((s) => s.debateRunning)
  const debateStatus = useAppStore((s) => s.debateStatus)
  const [showSettings, setShowSettings] = useState(false)
  const [showDebate, setShowDebate] = useState(false)
  const [showSideChat, setShowSideChat] = useState(false)
  const activeTab = useAppStore((s) => s.bottomTab)
  const setActiveTab = useAppStore((s) => s.setBottomTab)
  const setFileList = useAppStore((s) => s.setFileList)
  const diffDirty = useAppStore((s) => s.diffDirty)

  // One-time init: restore persisted state, then sync project root + key.
  useEffect(() => {
    ;(async () => {
      const persisted = (await window.api.state.load()) as
        | Partial<import('./store/appStore').PersistedState>
        | null
      if (persisted) {
        hydrate(persisted)
        if (persisted.projectRoot) await window.api.state.setRoot(persisted.projectRoot)
        else setProjectRoot(await window.api.fs.projectRoot())
      } else {
        setProjectRoot(await window.api.fs.projectRoot())
      }
      // Sync restored settings into main.
      const { geminiModel, debateRounds } = useAppStore.getState()
      window.api.settings.set({ geminiModel, debateRounds })
      setHasGeminiKey(await window.api.gemini.hasKey())
    })()

    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === ';') {
        e.preventDefault()
        setShowSideChat((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setProjectRoot, setHasGeminiKey, hydrate])

  // Keep the @-mention file list fresh (load + refresh on fs changes).
  useEffect(() => {
    const load = (): void => {
      window.api.fs.listFiles().then(setFileList)
    }
    load()
    return window.api.fs.onChanged(load)
  }, [setFileList])

  // Debounced persistence: save the serializable slice on any state change.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const unsub = useAppStore.subscribe(() => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const s = useAppStore.getState()
        window.api.state.save({
          projectRoot: s.projectRoot,
          selectedFile: s.selectedFile,
          geminiMessages: s.geminiMessages,
          debateUpdates: s.debateUpdates,
          debatePrompt: s.debatePrompt,
          geminiModel: s.geminiModel,
          debateRounds: s.debateRounds
        })
      }, 600)
    })
    return () => {
      if (t) clearTimeout(t)
      unsub()
    }
  }, [])

  // Always-mounted debate listeners: updates accumulate in the store even when
  // the DebateView is minimized or closed, so the run is never lost.
  useEffect(() => {
    const offUpdate = window.api.debate.onUpdate(addDebateUpdate)
    const offStatus = window.api.debate.onStatus(setDebateStatus)
    return () => {
      offUpdate()
      offStatus()
    }
  }, [addDebateUpdate, setDebateStatus])

  // Route incoming command proposals: auto-approve trusted sessions, else queue a toast.
  useEffect(() => {
    const off = window.api.command.onPending((c) => {
      // Trusted sessions auto-approve — EXCEPT dangerous commands, which always
      // require an explicit confirm regardless of trust.
      if (useAppStore.getState().isTrusted(c.sessionId) && !checkDangerous(c.command).dangerous) {
        window.api.command.approve(c.id)
      } else {
        addPending(c)
      }
    })
    return off
  }, [addPending])

  // File-edit proposals always require explicit review (writes are destructive).
  useEffect(() => {
    const offPending = window.api.edit.onPending(addPendingEdit)
    const offResult = window.api.edit.onResult((r) => removePendingEdit(r.id))
    return () => {
      offPending()
      offResult()
    }
  }, [addPendingEdit, removePendingEdit])

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <div className="flex items-center gap-3 border-b border-border bg-panel px-3 py-1.5 text-sm">
        <span className="font-semibold">Desktop AI</span>
        <FileMenu />
        <button
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
          onClick={() => setShowDebate(true)}
        >
          ⚔ Debate
        </button>
        <button
          className="ml-auto rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
          onClick={() => setShowSettings(true)}
        >
          {hasGeminiKey ? '⚙ Settings' : '⚙ Settings · set key'}
        </button>
      </div>

      {/* main layout */}
      <div className="min-h-0 flex-1">
        <Allotment>
          <Allotment.Pane preferredSize={200} minSize={120}>
            <div className="flex h-full flex-col">
              <SessionSidebar />
              <div className="flex-1 min-h-0">
                <FileTreePanel />
              </div>
            </div>
          </Allotment.Pane>
          <Allotment.Pane>
            <Allotment vertical>
              <Allotment.Pane preferredSize="60%">
                <Allotment>
                  <ClaudePane />
                  <GeminiChat />
                </Allotment>
              </Allotment.Pane>
              <Allotment.Pane>
                <div className="flex h-full flex-col">
                  <div className="flex border-b border-border bg-panel text-xs">
                    <button
                      className={`px-4 py-1.5 ${activeTab === 'terminal' ? 'border-b-2 border-accent text-accent font-semibold' : 'text-gray-400 hover:text-gray-200'}`}
                      onClick={() => setActiveTab('terminal')}
                    >
                      Terminal
                    </button>
                    <button
                      className={`px-4 py-1.5 ${activeTab === 'diff' ? 'border-b-2 border-accent text-accent font-semibold' : 'text-gray-400 hover:text-gray-200'}`}
                      onClick={() => setActiveTab('diff')}
                    >
                      Diff Viewer
                      {diffDirty && <span className="ml-1 text-yellow-400" title="unsaved changes">●</span>}
                    </button>
                    <button
                      className={`px-4 py-1.5 ${activeTab === 'git' ? 'border-b-2 border-accent text-accent font-semibold' : 'text-gray-400 hover:text-gray-200'}`}
                      onClick={() => setActiveTab('git')}
                    >
                      Git
                    </button>
                    <button
                      className={`px-4 py-1.5 ${activeTab === 'checkpoints' ? 'border-b-2 border-accent text-accent font-semibold' : 'text-gray-400 hover:text-gray-200'}`}
                      onClick={() => setActiveTab('checkpoints')}
                    >
                      Checkpoints
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">
                    {/* Terminal + Diff stay mounted (hidden) so shell scrollback
                        and unsaved edits survive tab switches. */}
                    <div className={activeTab === 'terminal' ? 'h-full' : 'hidden'}>
                      <TerminalPane />
                    </div>
                    <div className={activeTab === 'diff' ? 'h-full' : 'hidden'}>
                      <DiffViewer />
                    </div>
                    {activeTab === 'git' && <GitPanel onOpenDiff={() => setActiveTab('diff')} />}
                    {activeTab === 'checkpoints' && <CheckpointsPanel />}
                  </div>
                </div>
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </div>

      <CommandToast />
      <EditReview />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showDebate && <DebateView onClose={() => setShowDebate(false)} />}
      {showSideChat && <SideChat onClose={() => setShowSideChat(false)} />}

      {/* Floating pill: debate running or has results, but the panel is hidden. */}
      {!showDebate && debateRunning && (
        <button
          onClick={() => setShowDebate(true)}
          className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-border bg-panel px-4 py-2 text-xs shadow-xl hover:bg-bg"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-gray-200">{debateStatus || 'Debate running…'}</span>
          <span className="text-accent">open</span>
        </button>
      )}
    </div>
  )
}
