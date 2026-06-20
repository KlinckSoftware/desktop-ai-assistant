import { getDockApi } from './dockApi'
import { useAppStore } from '../store/appStore'

let seq = 0

// Open an API-chat instance as its own dock panel (tab beside the active panel).
export function openApiChat(providerId: string): void {
  const api = getDockApi()
  if (!api) return
  const provider = useAppStore.getState().apiProviders.find((p) => p.id === providerId)
  const name = provider?.name ?? providerId
  const n = api.panels.filter((p) => p.id.startsWith(`api-${providerId}-`)).length + 1
  const id = `api-${providerId}-${Date.now()}-${seq++}`
  api.addPanel({
    id,
    component: 'apichat',
    title: `${name} ${n}`,
    params: { instanceId: id, providerId },
    ...(api.activePanel ? { position: { referencePanel: api.activePanel.id, direction: 'within' as const } } : {})
  })
}
