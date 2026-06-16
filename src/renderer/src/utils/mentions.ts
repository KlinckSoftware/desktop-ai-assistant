// Expand @path mentions in a prompt by inlining each referenced file's
// contents. Paths resolve relative to the project root (or absolute). Reads go
// through window.api.fs, which confines them to the project root. Unreadable
// mentions are left untouched.

const MENTION = /@([^\s@`'"]+)/g

function toAbsolute(root: string, token: string): string {
  // Already absolute? (Windows drive or POSIX root)
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(token)) return token
  return `${root.replace(/[\\/]+$/, '')}/${token}`
}

export async function expandMentions(prompt: string, projectRoot: string): Promise<string> {
  const tokens = [...new Set([...prompt.matchAll(MENTION)].map((m) => m[1]))]
  if (tokens.length === 0 || !projectRoot) return prompt

  const blocks: string[] = []
  for (const token of tokens) {
    try {
      const content = await window.api.fs.readFile(toAbsolute(projectRoot, token))
      blocks.push(`### @${token}\n\`\`\`\n${content}\n\`\`\``)
    } catch {
      /* not a readable file — leave the @token as literal text */
    }
  }
  if (blocks.length === 0) return prompt
  return `${prompt}\n\n---\nReferenced files:\n${blocks.join('\n\n')}`
}
