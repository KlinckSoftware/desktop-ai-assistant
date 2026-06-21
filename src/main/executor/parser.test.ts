import { describe, it, expect } from 'vitest'
import { extractBashBlocks, CommandExtractor, extractFileEdits } from './parser'

describe('extractBashBlocks', () => {
  it('extracts a single fenced bash run block', () => {
    const text = 'before\n```bash run\nls -la\n```\nafter'
    expect(extractBashBlocks(text)).toEqual(['ls -la'])
  })

  it('extracts multiple blocks and trims', () => {
    const text = '```bash run\n  echo a  \n```\nx\n```bash run\necho b\n```'
    expect(extractBashBlocks(text)).toEqual(['echo a', 'echo b'])
  })

  it('ignores plain bash blocks (no "run")', () => {
    expect(extractBashBlocks('```bash\nls\n```')).toEqual([])
  })

  it('ignores empty blocks', () => {
    expect(extractBashBlocks('```bash run\n\n```')).toEqual([])
  })
})

describe('extractFileEdits', () => {
  it('extracts path + content from a file fence', () => {
    const text = '```file src/a.ts\nconst x = 1\n```'
    expect(extractFileEdits(text)).toEqual([{ path: 'src/a.ts', content: 'const x = 1' }])
  })

  it('drops only the single trailing newline, keeps interior blank lines', () => {
    const text = '```file a.txt\nline1\n\nline3\n```'
    expect(extractFileEdits(text)).toEqual([{ path: 'a.txt', content: 'line1\n\nline3' }])
  })

  it('extracts multiple file edits', () => {
    const text = '```file a.ts\nA\n```\ntext\n```file b/c.ts\nB\n```'
    expect(extractFileEdits(text)).toEqual([
      { path: 'a.ts', content: 'A' },
      { path: 'b/c.ts', content: 'B' }
    ])
  })

  it('trims the path and preserves an empty file body', () => {
    const text = '```file   spaced.ts  \n```'
    expect(extractFileEdits(text)).toEqual([{ path: 'spaced.ts', content: '' }])
  })

  it('returns [] when there are no file fences', () => {
    expect(extractFileEdits('```bash run\nls\n```')).toEqual([])
  })
})

describe('CommandExtractor (streaming dedupe)', () => {
  it('returns each command once as the buffer grows', () => {
    const ex = new CommandExtractor()
    expect(ex.extract('```bash run\nls\n``')).toEqual([]) // not closed yet
    const first = ex.extract('```bash run\nls\n```')
    expect(first).toEqual(['ls'])
    // Same buffer again -> no re-fire
    expect(ex.extract('```bash run\nls\n```')).toEqual([])
    // New block appended -> only the new one fires
    expect(ex.extract('```bash run\nls\n```\n```bash run\npwd\n```')).toEqual(['pwd'])
  })
})
