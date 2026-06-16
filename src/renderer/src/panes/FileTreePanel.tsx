import { useEffect, useState, useCallback } from 'react'
import type { FileNode } from '@shared/types'
import { useAppStore } from '../store/appStore'

function TreeNode({ node, depth }: { node: FileNode; depth: number }): JSX.Element {
  const [open, setOpen] = useState(depth < 1)
  const pad = { paddingLeft: `${depth * 12 + 8}px` }

  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const selectedFile = useAppStore((s) => s.selectedFile)

  if (!node.isDir) {
    return (
      <div 
        className={`cursor-default truncate py-0.5 hover:bg-panel ${selectedFile === node.path ? 'bg-panel text-accent font-semibold' : 'text-gray-300'}`} 
        style={pad}
        onClick={() => setSelectedFile(node.path)}
      >
        {node.name}
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
  const setProjectRoot = useAppStore((s) => s.setProjectRoot)

  const refresh = useCallback(() => {
    window.api.fs.readTree().then(setTree)
  }, [])

  useEffect(() => {
    refresh()
    const off = window.api.fs.onChanged(() => refresh())
    return off
  }, [refresh, projectRoot])

  const pickDir = async (): Promise<void> => {
    const root = await window.api.fs.pickDir()
    setProjectRoot(root)
    refresh()
  }

  return (
    <div className="flex h-full flex-col bg-bg text-xs">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="font-semibold text-accent">Files</span>
        <button className="rounded px-1.5 text-gray-400 hover:bg-panel" onClick={pickDir}>
          open…
        </button>
      </div>
      <div className="truncate px-3 py-1 text-[10px] text-gray-500" title={projectRoot}>
        {projectRoot}
      </div>
      <div className="flex-1 overflow-auto py-1">
        {tree?.children?.map((c) => <TreeNode key={c.path} node={c} depth={0} />)}
      </div>
    </div>
  )
}
