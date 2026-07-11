import { describe, it, expect } from 'vitest'
import { parseHunks, buildPatch } from './diffHunks'

const TWO_HUNK_DIFF = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,4 @@
 line1
+added-top
 line2
 line3
@@ -20,3 +21,4 @@
 line20
+added-bottom
 line21
 line22
`

const MULTI_FILE_DIFF = `diff --git a/a.txt b/a.txt
index 1111111..2222222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 a1
+a-new
 a2
diff --git a/b.txt b/b.txt
index 3333333..4444444 100644
--- a/b.txt
+++ b/b.txt
@@ -1,2 +1,3 @@
 b1
+b-new
 b2
`

const NEW_FILE_DIFF = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`

const DELETED_FILE_DIFF = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 1111111..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-hello
-world
`

const BINARY_DIFF = `diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
`

const NO_NEWLINE_DIFF = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,2 @@
 line1
-line2
\\ No newline at end of file
+line2-changed
\\ No newline at end of file
`

describe('parseHunks', () => {
  it('parses multiple hunks for a single file', () => {
    const files = parseHunks(TWO_HUNK_DIFF)
    expect(files).toHaveLength(1)
    expect(files[0].file).toBe('f.txt')
    expect(files[0].hunks).toHaveLength(2)
    expect(files[0].hunks[0].header).toBe('@@ -1,3 +1,4 @@')
    expect(files[0].hunks[0].lines).toContain('+added-top')
    expect(files[0].hunks[1].header).toBe('@@ -20,3 +21,4 @@')
    expect(files[0].hunks[1].lines).toContain('+added-bottom')
  })

  it('preserves header lines verbatim through the +++ line', () => {
    const files = parseHunks(TWO_HUNK_DIFF)
    expect(files[0].header).toEqual([
      'diff --git a/f.txt b/f.txt',
      'index 1111111..2222222 100644',
      '--- a/f.txt',
      '+++ b/f.txt'
    ])
  })

  it('handles multiple files', () => {
    const files = parseHunks(MULTI_FILE_DIFF)
    expect(files.map((f) => f.file)).toEqual(['a.txt', 'b.txt'])
    expect(files[0].hunks).toHaveLength(1)
    expect(files[1].hunks).toHaveLength(1)
  })

  it('handles a new file', () => {
    const files = parseHunks(NEW_FILE_DIFF)
    expect(files).toHaveLength(1)
    expect(files[0].file).toBe('new.txt')
    expect(files[0].header).toContain('new file mode 100644')
    expect(files[0].hunks[0].lines).toEqual(['+hello', '+world'])
  })

  it('handles a deleted file', () => {
    const files = parseHunks(DELETED_FILE_DIFF)
    expect(files).toHaveLength(1)
    expect(files[0].file).toBe('gone.txt')
    expect(files[0].header).toContain('deleted file mode 100644')
    expect(files[0].hunks[0].lines).toEqual(['-hello', '-world'])
  })

  it('excludes binary files from selectable output', () => {
    const files = parseHunks(BINARY_DIFF)
    expect(files).toHaveLength(0)
  })

  it('skips binary files but keeps subsequent text files', () => {
    const combo = BINARY_DIFF + MULTI_FILE_DIFF
    const files = parseHunks(combo)
    expect(files.map((f) => f.file)).toEqual(['a.txt', 'b.txt'])
  })

  it('handles "no newline at end of file" markers', () => {
    const files = parseHunks(NO_NEWLINE_DIFF)
    expect(files).toHaveLength(1)
    expect(files[0].hunks[0].lines).toEqual([
      ' line1',
      '-line2',
      '\\ No newline at end of file',
      '+line2-changed',
      '\\ No newline at end of file'
    ])
  })

  it('handles CRLF line endings', () => {
    const crlf = TWO_HUNK_DIFF.replace(/\n/g, '\r\n')
    const files = parseHunks(crlf)
    expect(files).toHaveLength(1)
    expect(files[0].hunks).toHaveLength(2)
    expect(files[0].hunks[0].lines).toContain('+added-top')
  })

  it('returns empty for blank input', () => {
    expect(parseHunks('')).toEqual([])
    expect(parseHunks('   \n  ')).toEqual([])
  })
})

describe('buildPatch', () => {
  it('reassembles a patch with only selected hunks, headers unrenumbered', () => {
    const files = parseHunks(TWO_HUNK_DIFF)
    const patch = buildPatch(files, (_file, idx) => idx === 1) // only 2nd hunk
    expect(patch).toContain('@@ -20,3 +21,4 @@')
    expect(patch).not.toContain('@@ -1,3 +1,4 @@')
    expect(patch).toContain('+added-bottom')
    expect(patch).not.toContain('+added-top')
  })

  it('omits files with zero selected hunks', () => {
    const files = parseHunks(MULTI_FILE_DIFF)
    const patch = buildPatch(files, (file) => file === 'a.txt')
    expect(patch).toContain('a.txt')
    expect(patch).not.toContain('b.txt')
  })

  it('returns empty string when nothing is selected', () => {
    const files = parseHunks(MULTI_FILE_DIFF)
    expect(buildPatch(files, () => false)).toBe('')
  })

  it('includes all files/hunks when everything is selected', () => {
    const files = parseHunks(MULTI_FILE_DIFF)
    const patch = buildPatch(files, () => true)
    expect(patch).toContain('a.txt')
    expect(patch).toContain('b.txt')
    expect(patch).toContain('+a-new')
    expect(patch).toContain('+b-new')
  })

  it('preserves new-file and deleted-file headers when selected', () => {
    const newFiles = parseHunks(NEW_FILE_DIFF)
    const newPatch = buildPatch(newFiles, () => true)
    expect(newPatch).toContain('new file mode 100644')
    expect(newPatch).toContain('--- /dev/null')

    const delFiles = parseHunks(DELETED_FILE_DIFF)
    const delPatch = buildPatch(delFiles, () => true)
    expect(delPatch).toContain('deleted file mode 100644')
    expect(delPatch).toContain('+++ /dev/null')
  })
})
