import { promises as fs } from 'fs'
import { join } from 'path'
import type { FileSystemManager } from './FileSystemManager'

// Aider-style repo map: a compact, language-agnostic outline of the project —
// every code file with its top-level declarations (functions, classes, types,
// exports). Lets an agent grasp the codebase shape in one read instead of
// grepping blind. Regex-based (no tree-sitter) so it stays cheap and covers
// many languages well enough to orient on.

const MAX_CHARS = 40_000 // cap — this rides in the model's context
const MAX_SIGS_PER_FILE = 40

// Per-extension matchers for "this line declares something an agent cares about".
// Broad on purpose: a few false positives beat missing a real declaration.
const DECL: Record<string, RegExp> = {
  ts: /^\s*(export\s+)?(default\s+)?(abstract\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|namespace)\s+\w/,
  py: /^\s*(async\s+)?(def|class)\s+\w/,
  kt: /^\s*(public|private|internal|protected\s+)?(abstract|open|sealed|data|enum\s+)?\s*(fun|class|object|interface|val|var)\s+\w/,
  java: /^\s*(public|private|protected|static|final|abstract|\s)+\s*(class|interface|enum|record|void|[\w<>\[\]]+)\s+\w+\s*[({]/,
  go: /^\s*(func|type)\s+\w/,
  rs: /^\s*(pub\s+)?(async\s+)?(fn|struct|enum|trait|impl|type|mod|const|static)\s+\w/,
  rb: /^\s*(def|class|module)\s+\w/,
  c: /^\s*[\w\*]+\s+\**\w+\s*\(/,
  cs: /^\s*(public|private|protected|internal|static|\s)+\s*(class|interface|enum|struct|void|[\w<>\[\]]+)\s+\w+\s*[({]/
}
DECL.tsx = DECL.ts
DECL.js = DECL.ts
DECL.jsx = DECL.ts
DECL.mjs = DECL.ts
DECL.cjs = DECL.ts
DECL.kts = DECL.kt
DECL.cpp = DECL.c
DECL.cc = DECL.c
DECL.h = DECL.c
DECL.hpp = DECL.c

function extOf(p: string): string {
  return p.split('.').pop()?.toLowerCase() ?? ''
}

// Trim a declaration line for the map: drop a trailing `{`, collapse runs of
// whitespace, cap length so a giant signature can't dominate.
function tidy(line: string): string {
  return line.trim().replace(/\s*\{?\s*$/, '').replace(/\s+/g, ' ').slice(0, 160)
}

export async function buildRepoMap(fsm: FileSystemManager, root: string): Promise<string> {
  const files = await fsm.listFiles(root, 4000)
  const sections: string[] = []
  let total = 0
  let skipped = 0

  for (const rel of files.sort()) {
    const re = DECL[extOf(rel)]
    if (!re) continue // not a recognized code file
    let text: string
    try {
      text = await fs.readFile(join(root, rel), 'utf-8')
    } catch {
      continue
    }
    const sigs: string[] = []
    for (const line of text.split('\n')) {
      if (line.length > 400) continue // minified / data line
      if (re.test(line)) {
        const t = tidy(line)
        if (t && !sigs.includes(t)) sigs.push(t)
        if (sigs.length >= MAX_SIGS_PER_FILE) break
      }
    }
    if (sigs.length === 0) continue
    const section = `${rel}:\n${sigs.map((s) => `  ${s}`).join('\n')}`
    if (total + section.length > MAX_CHARS) {
      skipped = files.length - files.indexOf(rel)
      break
    }
    total += section.length
    sections.push(section)
  }

  if (sections.length === 0) return 'Repo map: no recognized source files found.'
  const note = skipped > 0 ? `\n\n[…repo map truncated: ${skipped} more file(s) omitted at size cap]` : ''
  return `Repo map — top-level declarations per file (project structure overview):\n\n${sections.join('\n\n')}${note}`
}
