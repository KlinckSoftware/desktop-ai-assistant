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
