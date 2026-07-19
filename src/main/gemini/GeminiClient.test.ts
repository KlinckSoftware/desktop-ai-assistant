import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { promises as fs } from 'fs'

// Unique temp userData dir; electron.app.getPath is mocked to return it (same
// pattern as src/main/agents/registry.test.ts).
const TMP = vi.hoisted(() => require('path').join(require('os').tmpdir(), `gemini-img-test-${process.pid}`))

vi.mock('electron', () => ({ app: { getPath: () => TMP } }))
const mockSettings = vi.hoisted(() => ({
  geminiModel: 'gemini-2.5-flash',
  imageProvider: 'imagen' as 'imagen' | 'pollinations'
}))
vi.mock('../state', () => ({
  appState: { send: vi.fn(), settings: mockSettings }
}))
vi.mock('../keychain/KeychainManager', () => ({
  KeychainManager: { getKey: vi.fn(), setKey: vi.fn(), hasKey: vi.fn() }
}))
vi.mock('../tools/toolExec', () => ({
  toolSpecs: vi.fn(() => []),
  execTool: vi.fn(async () => 'tool-ok')
}))
vi.mock('../budget', () => ({
  addUsageCost: vi.fn(),
  capReached: vi.fn(() => false)
}))

import { GeminiClient, generatedImagesDir } from './GeminiClient'
import { KeychainManager } from '../keychain/KeychainManager'

describe('GeminiClient.generateImage', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let client: GeminiClient

  beforeEach(() => {
    vi.clearAllMocks()
    mockSettings.imageProvider = 'imagen'
    client = new GeminiClient()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await fs.rm(TMP, { recursive: true, force: true }).catch(() => {})
  })

  it('returns an error and never fetches when no API key is set', async () => {
    vi.mocked(KeychainManager.getKey).mockResolvedValue(null)
    const result = await client.generateImage('a cat')
    expect(result).toEqual({ error: 'no API key set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a parsed error detail on a non-OK HTTP response', async () => {
    vi.mocked(KeychainManager.getKey).mockResolvedValue('test-key')
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'quota exceeded'
    })
    const result = await client.generateImage('a cat')
    expect(result.error).toContain('429')
    expect(result.error).toContain('quota exceeded')
    expect(result.path).toBeUndefined()
  })

  it('returns an error when the response has no predictions', async () => {
    vi.mocked(KeychainManager.getKey).mockResolvedValue('test-key')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ predictions: [] })
    })
    const result = await client.generateImage('a cat')
    expect(result.error).toMatch(/no image returned/i)
  })

  it('decodes bytesBase64Encoded and writes a PNG under generated-images, returning its path', async () => {
    vi.mocked(KeychainManager.getKey).mockResolvedValue('test-key')
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ predictions: [{ bytesBase64Encoded: pngBytes.toString('base64') }] })
    })

    const result = await client.generateImage('a cat wearing a hat')

    expect(result.error).toBeUndefined()
    expect(result.path).toBeTruthy()
    expect(result.path).toContain(generatedImagesDir())
    expect(result.path).toMatch(/img_\d+_[a-z0-9]+\.png$/)

    const written = await fs.readFile(result.path as string)
    expect(written.equals(pngBytes)).toBe(true)

    // Correct endpoint + body shape.
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('imagen-3.0-generate-002:predict')
    expect(url).toContain('key=test-key')
    const body = JSON.parse(opts.body as string)
    expect(body).toEqual({
      instances: [{ prompt: 'a cat wearing a hat' }],
      parameters: { sampleCount: 1, aspectRatio: '1:1' }
    })
  })

  it('never throws — a network-level rejection becomes an error result', async () => {
    vi.mocked(KeychainManager.getKey).mockResolvedValue('test-key')
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const result = await client.generateImage('a cat')
    expect(result.error).toContain('fetch failed')
  })

  it('generatedImagesDir() is userData/generated-images', () => {
    expect(generatedImagesDir()).toBe(join(TMP, 'generated-images'))
  })

  describe('pollinations provider (free/keyless testing backend)', () => {
    beforeEach(() => {
      mockSettings.imageProvider = 'pollinations'
    })

    it('GETs the encoded prompt with no key and saves the returned bytes as jpg', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]).buffer
      fetchMock.mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => bytes
      })
      const result = await client.generateImage('a red cube & more')
      expect(result.error).toBeUndefined()
      expect(result.path).toMatch(/img_\d+_[a-z0-9]+\.jpg$/)
      expect(result.path).toContain('generated-images')
      const written = await fs.readFile(result.path!)
      expect([...written]).toEqual([1, 2, 3, 4])
      // Keyless: keychain never consulted, URL carries the encoded prompt, GET (no options body).
      expect(KeychainManager.getKey).not.toHaveBeenCalled()
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('image.pollinations.ai/prompt/')
      expect(url).toContain(encodeURIComponent('a red cube & more'))
      expect(url).not.toContain('key=')
    })

    it('maps an HTTP error to an error result without throwing', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429, statusText: 'rate limited', text: async () => 'slow down' })
      const result = await client.generateImage('a cat')
      expect(result.error).toContain('Pollinations error 429')
      expect(result.path).toBeUndefined()
    })

    it('an empty body is an error, not a zero-byte file', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new ArrayBuffer(0)
      })
      const result = await client.generateImage('a cat')
      expect(result.error).toContain('empty image response')
    })
  })
})
