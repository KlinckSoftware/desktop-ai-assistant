import { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { expandMentions } from '../utils/mentions'
import MentionInput from './MentionInput'
import { Z } from '../zIndex'

export default function SideChat({ onClose }: { onClose: () => void }): JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [isThinking, setIsThinking] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = async (): Promise<void> => {
    if (!prompt.trim() || isThinking) return
    setIsThinking(true)
    setReply('')

    try {
      // Expand @path mentions, then isolated one-shot (no main-chat mutation).
      const root = useAppStore.getState().projectRoot
      const expanded = await expandMentions(prompt, root)
      const text = await window.api.gemini.sideSend(expanded)
      setReply(text)
    } catch (err) {
      setReply(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsThinking(false)
      setPrompt('')
    }
  }

  return (
    <div
      style={{ zIndex: Z.dropdown }}
      className="absolute right-4 top-16 flex max-h-[60vh] w-96 flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold text-gemini">
        <span>✦ Quick Chat (Gemini)</span>
        <button aria-label="Close quick chat" onClick={onClose} className="text-gray-500 hover:text-gray-300">
          ✕
        </button>
      </div>
      
      {isThinking && !reply && (
        <div className="p-3 text-sm text-gray-500">…thinking</div>
      )}
      {reply && (
        <div className="flex-1 overflow-y-auto p-3 text-sm text-gray-300">
          <pre className="whitespace-pre-wrap font-sans">{reply}</pre>
        </div>
      )}

      <div className="flex border-t border-border p-2">
        <MentionInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          disabled={isThinking}
          rows={1}
          placeholder="Ask a quick question…  (@path to attach a file)"
        />
      </div>
    </div>
  )
}
