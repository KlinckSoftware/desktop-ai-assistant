import { DockviewReact, themeAbyss, type DockviewReadyEvent, type DockviewApi } from 'dockview'
import 'dockview/dist/styles/dockview.css'
import { components } from './panels'
import { setDockApi, PANELS, buildDefaultLayout } from './dockApi'
import { openDefaultAgent } from './agents'
import { useAppStore } from '../store/appStore'

// Add any known panel missing from a (possibly older) restored layout, so newly
// introduced panels still show up without forcing a layout reset.
function ensureAllPanels(api: DockviewApi): void {
  for (const def of PANELS) {
    if (!api.getPanel(def.id)) {
      api.addPanel({ id: def.id, component: def.id, title: def.title })
    }
  }
}

export default function DockLayout(): JSX.Element {
  const setDockLayout = useAppStore((s) => s.setDockLayout)

  const onReady = (event: DockviewReadyEvent): void => {
    const api = event.api
    setDockApi(api)

    if (api.panels.length === 0) {
      const saved = useAppStore.getState().dockLayout
      let restored = false
      if (saved) {
        try {
          api.fromJSON(saved as Parameters<DockviewApi['fromJSON']>[0])
          restored = api.panels.length > 0
        } catch {
          restored = false
        }
      }
      if (!restored) {
        api.clear()
        buildDefaultLayout(api)
      } else {
        ensureAllPanels(api)
        // Drop stale panels from a saved layout: dynamic agent instances (ids
        // contain '-', their ptys are dead) and the removed 'sessions'/'agent'
        // static panels from the pre-refactor schema.
        for (const p of [...api.panels]) {
          if (p.id.includes('-') || p.id === 'sessions' || p.id === 'agent') p.api.close()
        }
      }
      // Always start with one fresh agent instance.
      openDefaultAgent()
    }

    api.onDidLayoutChange(() => setDockLayout(api.toJSON()))
  }

  return <DockviewReact components={components} onReady={onReady} theme={themeAbyss} />
}
