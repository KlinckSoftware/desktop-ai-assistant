// Pure unified-diff parsing/reassembly for per-hunk accept/reject (Review panel
// "Select hunks" mode). No git/node dependencies — usable from main or renderer.
//
// A unified diff (as produced by `git diff`) is a sequence of per-file sections:
//   diff --git a/x b/x
//   index abc..def 100644          <- optional extra header lines
//   --- a/x                        <- old path
//   +++ b/x                        <- new path
//   @@ -1,3 +1,4 @@ optional-context
//   ...hunk body lines (' ', '+', '-', or '\ No newline at end of file')...
//   @@ -20,3 +21,4 @@
//   ...
//   diff --git a/y b/y
//   ...
//
// Binary files show as e.g. "Binary files a/x and b/x differ" (no --- / +++ /
// @@ lines) — such entries are parsed but excluded from the returned list since
// they have no hunks to select.

export interface Hunk {
  header: string // the '@@ -l,s +l,s @@ ...' line
  lines: string[] // body lines, each still prefixed with ' '/'+'/'-'/'\'
}

export interface FileHunks {
  file: string // display path (new-side path, or old-side for deletions)
  header: string[] // verbatim lines from 'diff --git' through '+++' (inclusive)
  hunks: Hunk[]
}

const DIFF_GIT_RE = /^diff --git a\/(.*) b\/(.*)$/

// Best-effort display name for a file section: prefer the +++ path, fall back
// to the --- path (deletions), fall back to the 'diff --git' new-side name.
function displayName(gitLine: string, minusLine: string | undefined, plusLine: string | undefined): string {
  const stripPrefix = (p: string): string => p.replace(/^[ab]\//, '')
  if (plusLine && plusLine !== '+++ /dev/null') return stripPrefix(plusLine.slice(4).trim())
  if (minusLine && minusLine !== '--- /dev/null') return stripPrefix(minusLine.slice(4).trim())
  const m = gitLine.match(DIFF_GIT_RE)
  return m ? m[2] : gitLine
}

/**
 * Parse a unified diff (as from `git diff`) into per-file hunk lists. Files
 * with no selectable hunks (binary) are omitted from the result. Tolerant of
 * CRLF line endings and `\ No newline at end of file` markers.
 */
export function parseHunks(unifiedDiff: string): FileHunks[] {
  if (!unifiedDiff.trim()) return []
  // Normalize CRLF -> LF for parsing; callers get LF-joined output, which git
  // apply handles fine (it detects/preserves line endings from the target file).
  const lines = unifiedDiff.replace(/\r\n/g, '\n').split('\n')

  const files: FileHunks[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].startsWith('diff --git ')) {
      i++
      continue
    }
    const gitLine = lines[i]
    const headerLines: string[] = [gitLine]
    i++
    let minusLine: string | undefined
    let plusLine: string | undefined
    let isBinary = false
    // Consume header lines (index/mode/similarity/binary/---/+++) until we hit
    // a hunk (@@) or the next file's 'diff --git' or EOF.
    while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff --git ')) {
      const l = lines[i]
      if (l.startsWith('Binary files ') || l.startsWith('GIT binary patch')) isBinary = true
      if (l.startsWith('--- ')) minusLine = l
      if (l.startsWith('+++ ')) plusLine = l
      headerLines.push(l)
      i++
    }

    const hunks: Hunk[] = []
    while (i < lines.length && lines[i].startsWith('@@')) {
      const hunkHeader = lines[i]
      i++
      const body: string[] = []
      while (
        i < lines.length &&
        !lines[i].startsWith('@@') &&
        !lines[i].startsWith('diff --git ')
      ) {
        // A hunk body line starts with ' ', '+', '-', or is the no-newline marker.
        const l = lines[i]
        if (l === '' && i === lines.length - 1) {
          // Trailing blank from a final split('\n') on a trailing newline — not
          // a real body line; stop the hunk here without consuming it.
          break
        }
        body.push(l)
        i++
      }
      // Trim a single trailing empty string that represents the diff's final
      // newline (split artifact), so it isn't treated as a context line.
      while (body.length && body[body.length - 1] === '' && i >= lines.length) body.pop()
      hunks.push({ header: hunkHeader, lines: body })
    }

    if (!isBinary && hunks.length > 0) {
      files.push({ file: displayName(gitLine, minusLine, plusLine), header: headerLines, hunks })
    }
    // Binary/no-hunk entries are simply skipped (not selectable), per spec.
  }
  return files
}

/**
 * Reassemble a unified diff containing only the hunks for which `selected`
 * returns true. Files with zero selected hunks are omitted entirely. Hunk
 * headers are preserved verbatim (not renumbered) — `git apply` computes line
 * offsets from the context/added/removed lines within each applied hunk, and
 * tolerates gaps left by omitted hunks in the old-file numbering as long as
 * hunks are applied in order and don't overlap, which is always true here
 * since they come from a single unmodified base diff. Verified in
 * WorktreeManager.hunks.integration.test.ts (apply hunk 2 only; base gets
 * hunk 2's change without hunk 1's).
 */
export function buildPatch(files: FileHunks[], selected: (file: string, hunkIndex: number) => boolean): string {
  const parts: string[] = []
  for (const f of files) {
    const chosen = f.hunks.filter((_, idx) => selected(f.file, idx))
    if (chosen.length === 0) continue
    parts.push(f.header.join('\n'))
    for (const h of chosen) {
      parts.push(h.header)
      if (h.lines.length) parts.push(h.lines.join('\n'))
    }
  }
  if (parts.length === 0) return ''
  return parts.join('\n') + '\n'
}
