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

export default function App(): JSX.Element {
  const setProjectRoot = useAppStore((s) => s.setProjectRoot)
  const setHasGeminiKey = useAppStore((s) => s.setHasGeminiKey)
  const hasGeminiKey = useAppStore((s) => s.hasGeminiKey)
  const addPending = useAppStore((s) => s.addPending)
  const [showKey, setShowKey] = useState(false)
  const [showDebate, setShowDebate] = useState(false)

  // One-time init.
  useEffect(() => {
    window.api.fs.projectRoot().then(setProjectRoot)
    window.api.gemini.hasKey().then(setHasGeminiKey)
  }, [setProjectRoot, setHasGeminiKey])

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
            <FileTreePanel />
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
                <TerminalPane />
              </Allotment.Pane>
            </Allotment>
          </Allotment.Pane>
        </Allotment>
      </div>

      <CommandToast />
      {showKey && <GeminiKeyModal onClose={() => setShowKey(false)} />}
      {showDebate && <DebateView onClose={() => setShowDebate(false)} />}
    </div>
  )
}
