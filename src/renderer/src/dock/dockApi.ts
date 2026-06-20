import type { DockviewApi } from 'dockview'

// Singleton handle to the dockview API so non-layout code (file tree, git panel)
// can focus/open panels without prop-drilling.
let api: DockviewApi | null = null

export function setDockApi(a: DockviewApi | null): void {
  api = a
}
export function getDockApi(): DockviewApi | null {
  return api
}

export interface PanelDef {
  id: string
  title: string
}

// All dockable panels, in default creation order.
export const PANELS: PanelDef[] = [
  { id: 'files', title: 'Files' },
  { id: 'gemini', title: 'Gemini' },
  { id: 'editor', title: 'Editor' },
  { id: 'terminal', title: 'Terminal' },
  { id: 'diff', title: 'Diff Viewer' },
  { id: 'git', title: 'Git' },
  { id: 'checkpoints', title: 'Checkpoints' },
  { id: 'debate', title: 'Debate' }
]

/** Focus an existing panel; if it was closed, re-add it first. */
export function focusPanel(id: string): void {
  if (!api) return
  const existing = api.getPanel(id)
  if (existing) {
    existing.api.setActive()
    return
  }
  const def = PANELS.find((p) => p.id === id)
  if (def) api.addPanel({ id: def.id, component: def.id, title: def.title })
}

export function togglePanel(id: string): void {
  if (!api) return
  const existing = api.getPanel(id)
  if (existing) existing.api.close()
  else focusPanel(id)
}

/** Close the currently focused panel (Ctrl+W). */
export function closeActivePanel(): void {
  api?.activePanel?.api.close()
}

/** Show/hide the left column (Sessions + Files) together (Ctrl+B). */
export function toggleSidebar(): void {
  if (!api) return
  const filesOpen = !!api.getPanel('files')
  if (filesOpen) api.getPanel('files')?.api.close()
  else focusPanel('files')
}

// Default arrangement. The bottom row is added relative to the ROOT (no
// referencePanel) so it spans the full width — giving one top/bottom divider
// across the whole window and letting the left/right columns be full height.
// Static panels only. Agent instances are added dynamically (openAgent) into
// the gap left of Gemini, so they're not part of the saved-restore set.
export function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'files', component: 'files', title: 'Files' })
  api.addPanel({
    id: 'gemini',
    component: 'gemini',
    title: 'Gemini',
    position: { referencePanel: 'files', direction: 'right' }
  })
  api.addPanel({
    id: 'debate',
    component: 'debate',
    title: 'Debate',
    position: { referencePanel: 'gemini', direction: 'within' }
  })
  // Full-width bottom row (relative to root → spans all columns).
  api.addPanel({ id: 'terminal', component: 'terminal', title: 'Terminal', position: { direction: 'below' } })
  for (const [id, title] of [
    ['editor', 'Editor'],
    ['git', 'Git'],
    ['diff', 'Diff Viewer'],
    ['checkpoints', 'Checkpoints']
  ] as const) {
    api.addPanel({ id, component: id, title, position: { referencePanel: 'terminal', direction: 'within' } })
  }
  try {
    api.getPanel('files')?.api.setSize({ width: 230 })
  } catch {
    /* best-effort sizing */
  }
  api.getPanel('gemini')?.api.setActive()
  api.getPanel('terminal')?.api.setActive()
}

/** Clear and rebuild the default layout (recover from any arrangement). */
export function resetLayout(): void {
  if (!api) return
  api.clear()
  buildDefaultLayout(api)
}
