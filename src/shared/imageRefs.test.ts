import { describe, it, expect } from 'vitest'
import { extractImageRefs } from './imageRefs'

describe('extractImageRefs', () => {
  it('finds a bare filename', () => {
    expect(extractImageRefs('see img_123_abc.png for the result')).toEqual(['img_123_abc.png'])
  })

  it('finds windows-style paths (backslash separators)', () => {
    const text = 'wrote it to C:\\Users\\me\\Pictures\\cat.jpg for review'
    expect(extractImageRefs(text)).toEqual(['C:\\Users\\me\\Pictures\\cat.jpg'])
  })

  it('finds posix-style paths (forward-slash separators)', () => {
    const text = 'saved at /home/me/out/render.webp, take a look'
    expect(extractImageRefs(text)).toEqual(['/home/me/out/render.webp'])
  })

  it('strips surrounding single, double, and backtick quotes', () => {
    expect(extractImageRefs('open "photo.png" now')).toEqual(['photo.png'])
    expect(extractImageRefs("open 'photo.png' now")).toEqual(['photo.png'])
    expect(extractImageRefs('open `photo.png` now')).toEqual(['photo.png'])
  })

  it('dedupes exact repeats, keeping first-appearance order', () => {
    const text = 'a.png then again a.png and finally b.jpg then a.png'
    expect(extractImageRefs(text)).toEqual(['a.png', 'b.jpg'])
  })

  it('caps at 4 refs even when more are present', () => {
    const text = 'one.png two.jpg three.jpeg four.webp five.gif six.png'
    const refs = extractImageRefs(text)
    expect(refs).toHaveLength(4)
    expect(refs).toEqual(['one.png', 'two.jpg', 'three.jpeg', 'four.webp'])
  })

  it('ignores non-image extensions', () => {
    const text = 'see report.pdf and notes.txt and data.json, no images here'
    expect(extractImageRefs(text)).toEqual([])
  })

  it('is case-insensitive on the extension', () => {
    expect(extractImageRefs('final.PNG and other.JPG')).toEqual(['final.PNG', 'other.JPG'])
  })

  it('handles gif/jpeg/webp extensions', () => {
    expect(extractImageRefs('a.gif b.jpeg c.webp')).toEqual(['a.gif', 'b.jpeg', 'c.webp'])
  })

  it('returns an empty array for empty or plain text', () => {
    expect(extractImageRefs('')).toEqual([])
    expect(extractImageRefs('nothing image-like in this sentence.')).toEqual([])
  })

  it('does not false-positive on a sentence ending in a period after a word', () => {
    // "png" appears but not as a `.png` extension token.
    expect(extractImageRefs('the format is png, not gif.')).toEqual([])
  })

  it('extracts multiple distinct refs from one string', () => {
    const text = 'before: before.png\nafter: after.jpg'
    expect(extractImageRefs(text)).toEqual(['before.png', 'after.jpg'])
  })
})
