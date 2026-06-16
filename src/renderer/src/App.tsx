import { useEffect, useState } from 'react'
import { Allotment } from 'allotment'
import { useAppStore } from './store/appStore'
import ClaudePane from './panes/ClaudePane'
import GeminiChat from './panes/GeminiChat'
import TerminalPane from './panes/TerminalPane'
import FileTreePanel from './panes/FileTreePanel'
import DebateView from './panes/DebateView'
import CommandToast from './components/CommandToast'
import GeminiKeyModal from './components/GeminiKeyModal'
import SessionSidebar from './components/SessionSidebar'
import SideChat from './components/SideChat'
import DiffViewer from './panes/DiffViewer'

export default function App(): JSX.Element {
  const setProjectRoot = useAppStore((s) => s.setProjectRoot)
  const setHasGeminiKey = useAppStore((s) => s.setHasGeminiKey)
  const hasGeminiKey = useAppStore((s) => s.hasGeminiKey)
  const addPending = useAppStore((s) => s.addPending)
  const addDebateUpdate = useAppStore((s) => s.addDebateUpdate)
  const setDebateStatus = useAppStore((s) => s.setDebateStatus)
  const debateRunning = useAppStore((s) => s.debateRunning)
  const debateStatus = useAppStore((s) => s.debateStatus)
  const [showKey, setShowKey] = useState(false)
  const [showDebate, setShowDebate] = useState(false)
  const [showSideChat, setShowSideChat] = useState(false)
  const [activeTab, setActiveTab] = useState<'terminal' | 'diff'>('terminal')

  // One-time init.
  useEffect(() => {
    window.api.fs.projectRoot().then(setProjectRoot)
    window.api.gemini.hasKey().then(setHasGeminiKey)

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ';') {
        e.preventDefault()
        setShowSideChat(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setProjectRoot, setHasGeminiKey])

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
      if (useAppStore.getState().isTrusted(c.sessionId)) {
        window.api.command.approve(c.id)
      } else {
        addPending(c)
      }
    })
    return off
  }, [addPending])

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <div className="flex items-center gap-3 border-b border-border bg-panel px-3 py-1.5 text-sm">
        <span className="font-semibold">Desktop AI</span>
        <button
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
          onClick={() => setShowDebate(true)}
        >
          ⚔ Debate
        </button>
        <button
          className="ml-auto rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
          onClick={() => setShowKey(true)}
        >
          {hasGeminiKey ? '✦ Gemini key set' : '✦ Set Gemini key'}
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
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">
                    {activeTab === 'terminal' && <TerminalPane />}
                    {activeTab === 'diff' && <DiffViewer />}
                  </div>
                </div>
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </div>

      <CommandToast />
      {showKey && <GeminiKeyModal onClose={() => setShowKey(false)} />}
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
