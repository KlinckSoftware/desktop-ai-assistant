// Extracts ```bash run\n...\n``` fenced blocks from an agent's text output.
// Tracks already-seen blocks per stream so streaming buffers don't re-fire the
// same command repeatedly as more text arrives.

const FENCE = /```bash run\s*\n([\s\S]*?)```/g

export class CommandExtractor {
  private seen = new Set<string>()

  /** Return newly-complete commands not yet seen. */
  extract(buffer: string): string[] {
    const out: string[] = []
    let m: RegExpExecArray | null
    FENCE.lastIndex = 0
    while ((m = FENCE.exec(buffer)) !== null) {
      const cmd = m[1].trim()
      if (!cmd) continue
      const key = `${m.index}:${cmd}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      out.push(cmd)
    }
    return out
  }

  reset(): void {
    this.seen.clear()
  }
}

/** One-shot extraction (no dedupe state) — used for completed (non-streamed) text. */
export function extractBashBlocks(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(FENCE.source, 'g')
  while ((m = re.exec(text)) !== null) {
    const cmd = m[1].trim()
    if (cmd) out.push(cmd)
  }
  return out
}

// Proposed file write: ```file <relative-path>\n<full new contents>\n```
const FILE_FENCE = /```file\s+([^\n`]+)\n([\s\S]*?)```/g

export interface FileEdit {
  path: string // as written by the agent (relative or absolute)
  content: string // full new file contents
}

export function extractFileEdits(text: string): FileEdit[] {
  const out: FileEdit[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(FILE_FENCE.source, 'g')
  while ((m = re.exec(text)) !== null) {
    const path = m[1].trim()
    // Drop a single trailing newline the fence adds; keep interior content as-is.
    const content = m[2].replace(/\n$/, '')
    if (path) out.push({ path, content })
  }
  return out
}
