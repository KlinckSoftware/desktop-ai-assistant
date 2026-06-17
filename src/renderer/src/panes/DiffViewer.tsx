import { useState, useEffect, useMemo } from 'react'
import * as Diff from 'diff'
import { html } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'
import { useAppStore } from '../store/appStore'

export default function DiffViewer(): JSX.Element {
  const selectedFile = useAppStore((s) => s.selectedFile)
  const setDiffDirty = useAppStore((s) => s.setDiffDirty)
  const [original, setOriginal] = useState('')
  const [modified, setModified] = useState('')
  // On-disk working copy as last loaded/saved — dirty = modified !== this.
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState('')

  const dirty = modified !== savedContent

  // Publish dirty state for the tab indicator; clear it when leaving the pane.
  useEffect(() => {
    setDiffDirty(dirty)
    return () => setDiffDirty(false)
  }, [dirty, setDiffDirty])

  const load = async (): Promise<void> => {
    if (!selectedFile) {
      setOriginal('')
      setModified('')
      setSavedContent('')
      return
    }
    try {
      const working = await window.api.fs.readFile(selectedFile)
      // If the file is git-tracked, baseline against HEAD so the diff shows the
      // actual uncommitted changes; otherwise baseline against the working copy.
      const head = await window.api.git.head(selectedFile)
      setOriginal(head ?? working)
      setModified(working)
      setSavedContent(working)
      setError('')
    } catch (err) {
      setError(`${err instanceof Error ? err.message : String(err)}`)
      setOriginal('')
      setModified('')
      setSavedContent('')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile])

  const handleSave = async (): Promise<void> => {
    if (!selectedFile) return
    try {
      await window.api.fs.writeFile(selectedFile, modified)
      await load() // re-baseline (HEAD stays original; working diff persists until commit)
    } catch (err) {
      setError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const diffHtml = useMemo(() => {
    if (!selectedFile) return ''
    const filename = selectedFile.split(/[/\\]/).pop() || 'file'
    const patch = Diff.createTwoFilesPatch(
      filename, filename,
      original, modified,
      'Original', 'Modified'
    )
    return html(patch, {
      outputFormat: 'side-by-side',
      drawFileList: false
    })
  }, [selectedFile, original, modified])

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-gray-500 text-sm">
        Select a file in the tree to view diff
      </div>
    )
  }

  // Binary / unreadable file: show the reason, never an empty editor.
  if (error && !savedContent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-bg text-sm text-gray-400">
        <div className="text-2xl">🚫</div>
        <div>{error}</div>
        <div className="text-xs text-gray-600">{selectedFile.split(/[/\\]/).pop()}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-panel">
        <span className="text-xs font-semibold text-accent truncate">
          Diff: {selectedFile.split(/[/\\]/).pop()}
          {dirty && <span className="ml-1 text-yellow-400" title="unsaved changes">●</span>}
        </span>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="rounded bg-accent px-3 py-0.5 text-xs text-bg disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-1/3 flex flex-col border-r border-border">
          <div className="bg-panel px-2 py-1 text-[10px] uppercase text-gray-500 border-b border-border">
            Editor
          </div>
          <textarea
            value={modified}
            onChange={(e) => setModified(e.target.value)}
            className="flex-1 resize-none bg-bg p-2 text-sm font-mono text-gray-200 outline-none"
            spellCheck={false}
          />
        </div>
        <div className="w-2/3 flex flex-col">
          <div className="bg-panel px-2 py-1 text-[10px] uppercase text-gray-500 border-b border-border">
            Preview
          </div>
          <div className="flex-1 overflow-auto bg-bg p-2 text-sm">
            <div
              className="diff2html-wrapper"
              dangerouslySetInnerHTML={{ __html: diffHtml }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
