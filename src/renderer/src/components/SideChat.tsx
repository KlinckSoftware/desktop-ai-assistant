import { useState, useEffect, useRef } from 'react'

export default function SideChat({ onClose }: { onClose: () => void }): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!prompt.trim() || isThinking) return
    setIsThinking(true)
    setReply('')

    const off = window.api.gemini.onStream((chunk) => {
      setReply((prev) => prev + chunk)
    })

    try {
      await window.api.gemini.send(prompt, [])
    } catch (err) {
      setReply(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      off()
      setIsThinking(false)
      setPrompt('')
    }
  }

  return (
    <div className="absolute right-4 top-16 z-50 flex max-h-[60vh] w-96 flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold text-gemini">
        <span>✦ Quick Chat (Gemini)</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          ✕
        </button>
      </div>
      
      {reply && (
        <div className="flex-1 overflow-y-auto p-3 text-sm text-gray-300">
          <pre className="whitespace-pre-wrap font-sans">{reply}</pre>
        </div>
      )}

      <form onSubmit={handleSubmit} className="border-t border-border p-2">
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask a quick question..."
          className="w-full rounded bg-bg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-gemini"
          disabled={isThinking}
        />
      </form>
    </div>
  )
}
