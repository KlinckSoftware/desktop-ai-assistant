import { useEffect, useState } from 'react'
import { Z } from '../zIndex'

// Shared renderer for one generated image — used by the Gemini chat bubbles and
// by StepOutput (Pipeline/Runs panels) so images look and behave the same
// everywhere. `file` is a bare filename under the generated-images dir, served
// only via the confined app-image:// protocol (src/main/gemini/imageProtocol.ts);
// the renderer has no fs access, so anything outside that dir simply 404s.
// Click opens a full-screen lightbox; Esc or a click anywhere closes it.
export default function GeneratedImage({
  file,
  size = 'chat',
  onLoad
}: {
  file: string
  // 'chat' = conversation bubble footprint, 'thumb' = step-output row thumbnail.
  size?: 'chat' | 'thumb'
  // Images load after their message mounts and grow the list — chat uses this
  // to re-scroll to the bottom once the real height is known.
  onLoad?: () => void
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (failed) {
    // 404 from the protocol handler: either not a generated image (a step-output
    // ref to some project file) or it was deleted by "Clear chat & run history".
    // Thumbnails just disappear (the step text still shows the path); a chat
    // bubble keeps a small placeholder so the conversation doesn't look broken.
    return size === 'chat' ? (
      <span className="text-[11px] italic text-gray-500">[image no longer available]</span>
    ) : null
  }

  return (
    <>
      <img
        src={`app-image://${file}`}
        alt={file}
        className={`cursor-zoom-in rounded-lg border border-border object-cover ${
          size === 'chat' ? 'max-h-48' : 'max-h-16'
        }`}
        onClick={() => setOpen(true)}
        onLoad={onLoad}
        onError={() => setFailed(true)}
        title="Click to view full size"
      />
      {open && (
        <div
          style={{ zIndex: Z.overlay }}
          className="fixed inset-0 flex cursor-zoom-out items-center justify-center bg-black/80 p-6"
          onClick={() => setOpen(false)}
        >
          <img src={`app-image://${file}`} alt={file} className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </>
  )
}
