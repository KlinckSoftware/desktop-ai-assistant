import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

// Simple JSON persistence of renderer UI state (chats, debate, project root) in
// the OS userData dir. Best-effort: failures degrade to a fresh session.

const file = (): string => join(app.getPath('userData'), 'state.json')

export async function loadState(): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file(), 'utf-8'))
  } catch {
    return null
  }
}

export async function saveState(data: unknown): Promise<void> {
  try {
    await fs.writeFile(file(), JSON.stringify(data), 'utf-8')
  } catch (err) {
    console.warn('[persistence] save failed:', (err as Error)?.message ?? err)
  }
}
