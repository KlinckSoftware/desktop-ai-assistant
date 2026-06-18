import { useState, useEffect, useMemo, useCallback } from 'react'
import * as Diff from 'diff'
import { html } from 'diff2html'
import { ColorSchemeType } from 'diff2html/lib/types'
import 'diff2html/bundles/css/diff2html.min.css'
import { useAppStore } from '../store/appStore'

// Read-only "what changed" view: the working file on disk vs git HEAD.
// Refreshes on file select and on any disk change (so saving in the Editor
// updates this automatically via the chokidar watcher). Editing happens in the
// Editor panel — this panel never writes.
export default function DiffViewer(): JSX.Element {
  const selectedFile = useAppStore((s) => s.selectedFile)
  const [original, setOriginal] = useState('') // HEAD
  const [working, setWorking] = useState('') // on disk
  const [error, setError] = useState('')
  const [untracked, setUntracked] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!selectedFile) {
      setOriginal('')
      setWorking('')
      setError('')
      return
    }
    try {
      const disk = await window.api.fs.readFile(selectedFile)
      const head = await window.api.git.head(selectedFile)
      setUntracked(head == null)
      setOriginal(head ?? '')
      setWorking(disk)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setOriginal('')
      setWorking('')
    }
  }, [selectedFile])

  useEffect(() => {
    load()
  }, [load])

  // Auto-refresh when files change on disk (e.g. after a save in the Editor).
  useEffect(() => {
    return window.api.fs.onChanged(() => load())
  }, [load])

  const diffHtml = useMemo(() => {
    if (!selectedFile || original === working) return ''
    const name = selectedFile.split(/[/\\]/).pop() || 'file'
    const patch = Diff.createTwoFilesPatch(name, name, original, working, '', '')
    return html(patch, {
      outputFormat: 'side-by-side',
      drawFileList: false,
      colorScheme: ColorSchemeType.DARK
    })
  }, [selectedFile, original, working])

  const name = selectedFile?.split(/[/\\]/).pop()

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-sm text-gray-500">
        Select a file to see its changes vs HEAD
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-bg text-sm text-gray-400">
        <div className="text-2xl">🚫</div>
        <div>{error}</div>
        <div className="text-xs text-gray-600">{name}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-1.5 text-xs">
        <span className="truncate font-semibold text-accent">Diff: {name}</span>
        <span className="text-gray-500">{untracked ? 'untracked (vs empty)' : 'vs HEAD'}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bg p-2 text-sm">
        {original === working ? (
          <div className="p-3 text-gray-500">No changes vs HEAD.</div>
        ) : (
          <div className="diff2html-wrapper" dangerouslySetInnerHTML={{ __html: diffHtml }} />
        )}
      </div>
    </div>
  )
}
