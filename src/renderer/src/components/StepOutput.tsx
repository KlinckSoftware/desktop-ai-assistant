import { useState } from 'react'
import { extractImageRefs } from '@shared/imageRefs'

// Shared step-output renderer for the Pipeline and Runs panels (ticket #17).
// Extracted so both panels render identically: the raw text, plus a thumbnail
// for any extracted image ref whose basename lives in the generated-images dir
// (the only images the renderer can actually show — everything else is served
// only via the confined app-image:// protocol, see src/main/gemini/imageProtocol.ts).
// Non-generated refs (e.g. a project file path) render as plain text, same as
// today. Reuses the click-to-expand lightbox pattern from GeminiChat.tsx (#16).
export default function StepOutput({ text }: { text: string }): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  const refs = extractImageRefs(text)

  return (
    <div>
      <div className="whitespace-pre-wrap text-gray-200">{text}</div>
      {refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {refs.map((ref) => {
            // The renderer has no fs access — it can only ever display images
            // through app-image://<basename>, which only resolves inside the
            // generated-images dir. A ref pointing elsewhere just isn't shown
            // as a thumbnail (the text above already shows the path).
            const basename = ref.split(/[\\/]/).pop() ?? ref
            const key = `${ref}`
            return (
              <img
                key={key}
                src={`app-image://${basename}`}
                alt={basename}
                className={`cursor-pointer rounded-lg border border-border object-cover ${
                  expanded === key ? 'max-h-80' : 'max-h-16'
                }`}
                onClick={() => setExpanded((v) => (v === key ? null : key))}
                onError={(e) => {
                  // Not actually a generated image (404 from the protocol handler) —
                  // hide the broken thumbnail; the text rendering above still shows the ref.
                  ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                }}
                title="Click to toggle full size"
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
