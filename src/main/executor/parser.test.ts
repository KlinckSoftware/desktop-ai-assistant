import { describe, it, expect } from 'vitest'
import { extractBashBlocks, CommandExtractor } from './parser'

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
