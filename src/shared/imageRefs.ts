// Pure text-scanning helper: pulls out file-path-looking tokens that end in a
// known image extension from arbitrary agent/step output. Used by the pipeline
// runner (to find images to load for vision-capable steps) and by the Runs /
// Pipeline panels (to render thumbnails beneath a step's text). No fs access —
// callers decide how/whether to resolve a ref to real bytes.

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif']

// A path-looking token: optional quotes, then a run of path/filename chars
// (letters, digits, spaces, `._-`, and either `/` or `\` as separators),
// ending in `.` + one of the image extensions. Word-boundary-ish on the left
// via a negative lookbehind-free approach (JS regex doesn't need it here since
// we anchor on whitespace/quote/start via \S boundaries implicitly).
const REF_RE = new RegExp(
  `["'\`]?([^\\s"'\`]+\\.(?:${IMAGE_EXT.join('|')}))["'\`]?`,
  'gi'
)

/**
 * Extract up to 4 unique, file-path-looking references to images (.png/.jpg/
 * .jpeg/.webp/.gif) from `text`. Handles both Windows (`C:\foo\bar.png`,
 * `foo\bar.png`) and POSIX (`/foo/bar.png`, `foo/bar.png`) separators, bare
 * filenames, and single/double/backtick-quoted paths. Order of first
 * appearance is preserved; duplicates (exact string match) are dropped.
 */
export function extractImageRefs(text: string): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  REF_RE.lastIndex = 0
  while ((m = REF_RE.exec(text)) !== null) {
    const ref = m[1]
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    out.push(ref)
    if (out.length >= 4) break
  }
  return out
}
