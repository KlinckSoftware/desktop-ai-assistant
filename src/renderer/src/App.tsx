import { useEffect, useState } from 'react'
import { checkDangerous } from '@shared/dangerousCommand'
import { useAppStore } from './store/appStore'
import DockLayout from './dock/DockLayout'
import { focusPanel } from './dock/dockApi'
import CommandToast from './components/CommandToast'
import EditReview from './components/EditReview'
import SettingsModal from './components/SettingsModal'
import FileMenu from './components/FileMenu'
import ViewMenu from './components/ViewMenu'
import SideChat from './components/SideChat'

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
  const setFileList = useAppStore((s) => s.setFileList)
  const [showSettings, setShowSettings] = useState(false)
  const [showSideChat, setShowSideChat] = useState(false)
  // Gate the dock layout until persisted state (incl. saved layout) is hydrated,
  // so DockLayout's onReady can restore the saved arrangement.
  const [ready, setReady] = useState(false)

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
      const { geminiModel, debateRounds } = useAppStore.getState()
      window.api.settings.set({ geminiModel, debateRounds })
      setHasGeminiKey(await window.api.gemini.hasKey())
      setReady(true)
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

  // Keep the @-mention file list fresh.
  useEffect(() => {
    const load = (): void => {
      window.api.fs.listFiles().then(setFileList)
    }
    load()
    return window.api.fs.onChanged(load)
  }, [setFileList])

  // Debounced persistence of the serializable slice (incl. dock layout).
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
          debateRounds: s.debateRounds,
          dockLayout: s.dockLayout
        })
      }, 600)
    })
    return () => {
      if (t) clearTimeout(t)
      unsub()
    }
  }, [])

  // Always-mounted debate listeners.
  useEffect(() => {
    const offUpdate = window.api.debate.onUpdate(addDebateUpdate)
    const offStatus = window.api.debate.onStatus(setDebateStatus)
    return () => {
      offUpdate()
      offStatus()
    }
  }, [addDebateUpdate, setDebateStatus])

  // Command proposals: auto-approve trusted sessions, except dangerous commands.
  useEffect(() => {
    const off = window.api.command.onPending((c) => {
      if (useAppStore.getState().isTrusted(c.sessionId) && !checkDangerous(c.command).dangerous) {
        window.api.command.approve(c.id)
      } else {
        addPending(c)
      }
    })
    return off
  }, [addPending])

  // File-edit proposals always require explicit review.
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
      <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1.5 text-sm">
        <span className="mr-1 font-semibold">Desktop AI</span>
        <FileMenu />
        <ViewMenu />
        <button
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
          onClick={() => focusPanel('debate')}
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

      {/* dockable workspace */}
      <div className="min-h-0 flex-1">
        {ready && <DockLayout />}
      </div>

      <CommandToast />
      <EditReview />
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showSideChat && <SideChat onClose={() => setShowSideChat(false)} />}

      {/* Debate-running indicator → focuses the docked Debate panel. */}
      {debateRunning && (
        <button
          onClick={() => focusPanel('debate')}
          className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-border bg-panel px-4 py-2 text-xs shadow-xl hover:bg-bg"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-gray-200">{debateStatus || 'Debate running…'}</span>
          <span className="text-accent">show</span>
        </button>
      )}
    </div>
  )
}
