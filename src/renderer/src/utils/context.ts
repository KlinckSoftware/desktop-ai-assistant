// Shared context pool helper. The pool is a set of project file paths (store:
// contextFiles) that EVERY prompt-controlled agent (Gemini + the API chats)
// prepends to each message, so context is selected once and shared across the
// whole cockpit rather than per-agent.

const MAX_CHARS = 100_000 // hard cap so a fat pool can't blow the model's window

// Read the pooled files (and optionally the repo map) and format them as a
// single context block. Returns '' when nothing is pooled. Unreadable/binary
// files are noted, not fatal.
export async function buildContextBlock(paths: string[], includeRepoMap = false): Promise<string> {
  const blocks: string[] = []
  if (includeRepoMap) {
    try {
      const map = await window.api.fs.repoMap()
      if (map) blocks.push(map)
    } catch {
      /* repo map is best-effort */
    }
  }
  if (paths.length === 0) return blocks.join('\n\n---\n\n')
  const parts: string[] = []
  let total = 0
  for (const p of paths) {
    const name = p.split(/[/\\]/).pop()
    let body: string
    try {
      body = await window.api.fs.readFile(p)
    } catch {
      parts.push(`### File: ${name} (${p})\n[unreadable]`)
      continue
    }
    if (total + body.length > MAX_CHARS) {
      const room = Math.max(0, MAX_CHARS - total)
      body = body.slice(0, room) + '\n[…truncated: context pool size cap reached]'
      parts.push(`### File: ${name} (${p})\n\`\`\`\n${body}\n\`\`\``)
      break
    }
    total += body.length
    parts.push(`### File: ${name} (${p})\n\`\`\`\n${body}\n\`\`\``)
  }
  blocks.push(
    `The following ${paths.length} file(s) are shared context for this request:\n\n${parts.join('\n\n')}`
  )
  return blocks.join('\n\n---\n\n')
}

// Paste-friendly context for an interactive CLI agent (Claude Code, Aider, …).
// Unlike buildContextBlock we DON'T inline file contents — the CLI reads files
// itself; we just hand it the relative paths. The repo map text IS inlined
// (the CLI can't generate it). Returns '' when nothing is pooled.
export async function buildCliContext(
  paths: string[],
  includeRepoMap: boolean,
  root: string
): Promise<string> {
  const blocks: string[] = []
  if (includeRepoMap) {
    try {
      const map = await window.api.fs.repoMap()
      if (map) blocks.push(map)
    } catch {
      /* best-effort */
    }
  }
  if (paths.length > 0) {
    const norm = root.replace(/[/\\]+$/, '')
    const rels = paths.map((p) => {
      const r = p.startsWith(norm) ? p.slice(norm.length).replace(/^[/\\]+/, '') : p
      return r.split('\\').join('/')
    })
    blocks.push(`Please use these project files as context:\n${rels.map((r) => `- ${r}`).join('\n')}`)
  }
  return blocks.join('\n\n')
}
