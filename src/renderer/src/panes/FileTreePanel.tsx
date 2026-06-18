import { useEffect, useState, useCallback } from 'react'
import type { FileNode } from '@shared/types'
import { useAppStore } from '../store/appStore'

// Map a porcelain code to a one-char badge + color.
function badge(code: string | undefined): { ch: string; cls: string } | null {
  if (!code) return null
  if (code === '??') return { ch: 'U', cls: 'text-green-400' }
  if (code.includes('M')) return { ch: 'M', cls: 'text-yellow-400' }
  if (code.includes('A')) return { ch: 'A', cls: 'text-green-400' }
  if (code.includes('D')) return { ch: 'D', cls: 'text-red-400' }
  return { ch: code[0], cls: 'text-gray-400' }
}

function TreeNode({ node, depth }: { node: FileNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const pad = { paddingLeft: `${depth * 12 + 4}px` }

  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const openFile = useAppStore((s) => s.openFile)
  const selectedFile = useAppStore((s) => s.selectedFile)
  const gitStatus = useAppStore((s) => s.gitStatus)
  const contextFiles = useAppStore((s) => s.contextFiles)
  const toggleContextFile = useAppStore((s) => s.toggleContextFile)

  if (!node.isDir) {
    const b = badge(gitStatus[node.path])
    const checked = contextFiles.has(node.path)
    return (
      <div
        className={`group flex items-center gap-1 py-0.5 hover:bg-panel ${
          selectedFile === node.path ? 'bg-panel text-accent font-semibold' : 'text-gray-300'
        }`}
        style={pad}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleContextFile(node.path)}
          onClick={(e) => e.stopPropagation()}
          className="h-3 w-3 shrink-0 accent-gemini"
          title="Add to prompt context"
        />
        <span
          className="flex-1 cursor-pointer truncate"
          onClick={() => setSelectedFile(node.path)}
          onDoubleClick={() => openFile(node.path)}
          title="Click to select · double-click to open in editor"
        >
          {node.name}
        </span>
        {b && <span className={`shrink-0 font-mono text-[10px] ${b.cls}`}>{b.ch}</span>}
      </div>
    )
  }
  return (
    <div>
      <div
        className="cursor-pointer truncate py-0.5 font-medium text-accent hover:bg-panel"
        style={pad}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} {node.name}
      </div>
      {open && node.children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
    </div>
  )
}

export default function FileTreePanel(): JSX.Element {
  const [tree, setTree] = useState<FileNode | null>(null)
  const projectRoot = useAppStore((s) => s.projectRoot)
  const setGitStatus = useAppStore((s) => s.setGitStatus)
  const contextFiles = useAppStore((s) => s.contextFiles)
  const clearContextFiles = useAppStore((s) => s.clearContextFiles)
  const setPendingGeminiContext = useAppStore((s) => s.setPendingGeminiContext)

  const refresh = useCallback(() => {
    window.api.fs.readTree().then(setTree)
    window.api.git.status().then(setGitStatus)
  }, [setGitStatus])

  useEffect(() => {
    refresh()
    const off = window.api.fs.onChanged(() => refresh())
    return off
  }, [refresh, projectRoot])

  const attach = async (): Promise<void> => {
    const paths = [...contextFiles]
    if (paths.length === 0) return
    const parts = await Promise.all(
      paths.map(async (p) => {
        try {
          const content = await window.api.fs.readFile(p)
          const name = p.split(/[/\\]/).pop()
          return `### File: ${name} (${p})\n\`\`\`\n${content}\n\`\`\``
        } catch {
          return `### File: ${p}\n[unreadable]`
        }
      })
    )
    setPendingGeminiContext(
      `The following ${paths.length} file(s) are attached as context:\n\n${parts.join('\n\n')}`
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg text-xs">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-semibold text-accent">Files</span>
        <span className="text-[10px] text-gray-600">File ▾ to open</span>
      </div>
      <div className="truncate px-3 py-1 text-[10px] text-gray-500" title={projectRoot}>
        {projectRoot}
      </div>
      <div className="flex-1 overflow-auto py-1">
        {tree?.children?.map((c) => <TreeNode key={c.path} node={c} depth={0} />)}
      </div>
      {contextFiles.size > 0 && (
        <div className="flex items-center gap-1 border-t border-border p-2">
          <button
            className="flex-1 rounded bg-gemini py-1 text-[11px] font-medium text-white"
            onClick={attach}
          >
            ✦ Attach {contextFiles.size} to Gemini
          </button>
          <button
            className="rounded border border-border px-2 py-1 text-gray-400 hover:bg-panel"
            onClick={clearContextFiles}
            title="Clear selection"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
