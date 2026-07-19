import { extractImageRefs } from '@shared/imageRefs'
import GeneratedImage from './GeneratedImage'

// Shared step-output renderer for the Pipeline and Runs panels (ticket #17).
// Extracted so both panels render identically: the raw text, plus a thumbnail
// for any extracted image ref whose basename lives in the generated-images dir
// (the only images the renderer can actually show — everything else is served
// only via the confined app-image:// protocol, see src/main/gemini/imageProtocol.ts).
// Non-generated refs (e.g. a project file path) render as plain text, same as
// today: GeneratedImage hides itself on a protocol 404, and the text above
// already shows the path. Thumbnails use the same lightbox as the Gemini chat.
export default function StepOutput({ text }: { text: string }): JSX.Element {
  const refs = extractImageRefs(text)

  return (
    <div>
      <div className="whitespace-pre-wrap text-gray-200">{text}</div>
      {refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {refs.map((ref) => (
            <GeneratedImage key={ref} file={ref.split(/[\\/]/).pop() ?? ref} size="thumb" />
          ))}
        </div>
      )}
    </div>
  )
}
