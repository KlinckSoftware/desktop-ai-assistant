import { useEffect, useState } from 'react'
import { checkDangerous } from '@shared/dangerousCommand'
import { setPriceOverrides } from '@shared/pricing'
import { useAppStore } from './store/appStore'
import DockLayout from './dock/DockLayout'
import { focusPanel, closeActivePanel, toggleSidebar } from './dock/dockApi'
import CommandToast from './components/CommandToast'
import EditReview from './components/EditReview'
import SettingsModal from './components/SettingsModal'
import FileMenu from './components/FileMenu'
import AgentMenu from './components/AgentMenu'
import ApiMenu from './components/ApiMenu'
import ViewMenu from './components/ViewMenu'
import SideChat from './components/SideChat'
import QuickOpen from './components/QuickOpen'
import { Z } from './zIndex'

export default function App(): JSX.Element {
  const setProjectRoot = useAppStore((s) => s.setProjectRoot)
  const setHasGeminiKey = useAppStore((s) => s.setHasGeminiKey)
  const hasGeminiKey = useAppStore((s) => s.hasGeminiKey)
  const addPending = useAppStore((s) => s.addPending)
  const addPendingEdit = useAppStore((s) => s.addPendingEdit)
  const removePendingEdit = useAppStore((s) => s.removePendingEdit)
  const addPendingTool = useAppStore((s) => s.addPendingTool)
  const hydrate = useAppStore((s) => s.hydrate)
  const addDebateUpdate = useAppStore((s) => s.addDebateUpdate)
  const setDebateStatus = useAppStore((s) => s.setDebateStatus)
  const debateRunning = useAppStore((s) => s.debateRunning)
  const debateStatus = useAppStore((s) => s.debateStatus)
  const setFileList = useAppStore((s) => s.setFileList)
  const setAgents = useAppStore((s) => s.setAgents)
  const setApiProviders = useAppStore((s) => s.setApiProviders)
  const addAttachment = useAppStore((s) => s.addAttachment)
  const [showSettings, setShowSettings] = useState(false)
  const [showSideChat, setShowSideChat] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
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
      const { geminiModel, claudeModel, claudeEffort, debateRounds, terminalShell } =
        useAppStore.getState()
      window.api.settings.set({ geminiModel, claudeModel, claudeEffort, debateRounds, terminalShell })
      setAgents(await window.api.agent.list())
      setApiProviders(await window.api.api.providers())
      setHasGeminiKey(await window.api.gemini.hasKey())
      setReady(true)
    })()

    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === ';') {
        e.preventDefault()
        setShowSideChat((prev) => !prev)
      } else if (k === 'p') {
        e.preventDefault() // would otherwise open the print dialog
        setShowQuickOpen(true)
      } else if (k === 'w') {
        e.preventDefault()
        closeActivePanel()
      } else if (k === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (e.key === '`') {
        e.preventDefault()
        focusPanel('terminal')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setProjectRoot, setHasGeminiKey, hydrate, setAgents, setApiProviders])

  // Global drag-and-drop: folder → switch project; image → multimodal attach;
  // text file → context attach. Shown as pills in the Gemini composer.
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => e.preventDefault()
    const onDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      for (const f of files) {
        const path = (f as unknown as { path?: string }).path
        if (!path) continue
        const id = `a_${Date.now()}_${Math.random().toString(36).slice(2)}`
        try {
          const info = await window.api.fs.classify(path)
          if (info.kind === 'dir') {
            if (window.confirm(`Open "${info.name}" as the project?`)) {
              setProjectRoot(await window.api.state.setRoot(path))
            }
          } else if (info.kind === 'image') {
            const img = await window.api.fs.readImage(path)
            addAttachment({ id, path, name: info.name, kind: 'image', mime: img.mime, base64: img.base64 })
          } else {
            addAttachment({ id, path, name: info.name, kind: 'text' })
          }
        } catch {
          /* ignore unreadable drops */
        }
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [setProjectRoot, addAttachment])

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
          claudeModel: s.claudeModel,
          claudeEffort: s.claudeEffort,
          debateRounds: s.debateRounds,
          debateSideA: s.debateSideA,
          debateSideB: s.debateSideB,
          terminalShell: s.terminalShell,
          dockLayout: s.dockLayout,
          apiChats: s.apiChats,
          pipelines: s.pipelines
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

  // MCP tool calls: auto-approve trusted tools, else queue an approval card.
  useEffect(() => {
    return window.api.tool.onPending((t) => {
      if (useAppStore.getState().isToolTrusted(t.tool)) window.api.tool.approve(t.id)
      else addPendingTool(t)
    })
  }, [addPendingTool])

  // Provider-reported token usage → cockpit fleet (always on, even if Cockpit closed).
  useEffect(() => {
    return window.api.onUsage((id, u) => useAppStore.getState().addUsage(id, u.promptTokens, u.completionTokens))
  }, [])

  // Overlay the live (LiteLLM) price table over the static snapshot, once.
  useEffect(() => {
    window.api
      .pricingLive()
      .then((table) => {
        if (table && Object.keys(table).length) setPriceOverrides(table)
      })
      .catch(() => {})
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* top bar */}
      <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1.5 text-sm">
        <span className="mr-1 font-semibold">Desktop AI</span>
        <FileMenu />
        <AgentMenu />
        <ApiMenu />
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
      {showQuickOpen && <QuickOpen onClose={() => setShowQuickOpen(false)} />}

      {/* Debate-running indicator → focuses the docked Debate panel. */}
      {debateRunning && (
        <button
          onClick={() => focusPanel('debate')}
          style={{ zIndex: Z.floating }}
          className="fixed bottom-4 left-4 flex items-center gap-2 rounded-full border border-border bg-panel px-4 py-2 text-xs shadow-xl hover:bg-bg"
        >
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-gray-200">{debateStatus || 'Debate running…'}</span>
          <span className="text-accent">show</span>
        </button>
      )}
    </div>
  )
}
