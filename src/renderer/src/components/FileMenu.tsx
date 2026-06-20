import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { Z } from '../zIndex'

const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p

// Top-bar File menu — IDE-style. "Open Project" sets the stable root for the
// tree + FS + git + default session cwd. "Open Session in Folder" spawns a new
// Claude session rooted in a chosen folder without touching the project root.
export default function FileMenu(): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const setProjectRoot = useAppStore((s) => s.setProjectRoot)
  const clearContextFiles = useAppStore((s) => s.clearContextFiles)
  const addSession = useAppStore((s) => s.addSession)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const openProject = async (): Promise<void> => {
    setOpen(false)
    const root = await window.api.fs.pickDir() // sets project root in main
    setProjectRoot(root)
    clearContextFiles()
  }

  const openSessionInFolder = async (): Promise<void> => {
    setOpen(false)
    const folder = await window.api.fs.pickFolder() // no root change
    if (!folder) return
    const id = `claude-${Date.now()}`
    await window.api.agent.newSession(id, 'claude', folder)
    addSession({ id, agentId: 'claude', label: basename(folder), cwd: folder })
  }

  return (
    <div ref={ref} className="relative">
      <button
        className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
        onClick={() => setOpen((o) => !o)}
      >
        File ▾
      </button>
      {open && (
        <div
          style={{ zIndex: Z.dropdown }}
          className="absolute left-0 top-full mt-1 w-56 rounded border border-border bg-panel py-1 text-xs shadow-xl"
        >
          <button className="block w-full px-3 py-1.5 text-left hover:bg-bg" onClick={openProject}>
            Open Project…
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-bg"
            onClick={openSessionInFolder}
          >
            Open Session in Folder…
          </button>
        </div>
      )}
    </div>
  )
}
