import { useEffect, useState } from 'react'
import { useAppStore } from '../store/appStore'
import CodeEditor from '../components/CodeEditor'

// Plain file editor — open, edit, save. No diff. This is the default target
// when you open a file from the tree; the Diff Viewer is a separate panel.
export default function FileEditor(): JSX.Element {
  const selectedFile = useAppStore((s) => s.selectedFile)
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const dirty = content !== saved

  const load = async (): Promise<void> => {
    if (!selectedFile) {
      setContent('')
      setSaved('')
      setError('')
      return
    }
    try {
      const text = await window.api.fs.readFile(selectedFile)
      setContent(text)
      setSaved(text)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setContent('')
      setSaved('')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile])

  const save = async (): Promise<void> => {
    if (!selectedFile || !dirty) return
    try {
      await window.api.fs.writeFile(selectedFile, content)
      setSaved(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-sm text-gray-500">
        Open a file from the tree (double-click) to edit
      </div>
    )
  }
  if (error && !saved) {
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
      <div className="flex items-center justify-between border-b border-border bg-panel px-3 py-1.5">
        <span className="truncate text-xs font-semibold text-accent">
          {selectedFile.split(/[/\\]/).pop()}
          {dirty && <span className="ml-1 text-yellow-400" title="unsaved changes">●</span>}
        </span>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button
            onClick={save}
            disabled={!dirty}
            className="rounded bg-accent px-3 py-0.5 text-xs text-bg disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeEditor value={content} onChange={setContent} path={selectedFile} />
      </div>
    </div>
  )
}
