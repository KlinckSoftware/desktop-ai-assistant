import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../state', () => ({
  appState: { send: vi.fn() }
}))
vi.mock('./providers', () => ({
  getProvider: vi.fn(),
  getKey: vi.fn()
}))
vi.mock('../tools/toolExec', () => ({
  toolSpecs: vi.fn(() => []),
  execTool: vi.fn(async () => 'tool-ok')
}))
vi.mock('../budget', () => ({
  addUsageCost: vi.fn(),
  capReached: vi.fn(() => false)
}))

import { apiComplete, apiSend, apiCompleteAgentic } from './OpenAIClient'
import { appState } from '../state'
import { getProvider, getKey } from './providers'
import { execTool } from '../tools/toolExec'
import { addUsageCost, capReached } from '../budget'
import { CH, type Message } from '../../shared/types'
import type { ApprovalPolicy } from '../policy/ApprovalPolicy'

const HISTORY: Message[] = [{ role: 'user', content: 'question' }]

// --- Response fakes (the client only touches ok/status/text/json/body) -------

function okJson(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  } as unknown as Response
}

function errRes(status: number, body = 'boom'): Response {
  return { ok: false, status, statusText: String(status), text: async () => body } as unknown as Response
}

// Streaming SSE response. `failAfter` makes read() throw `failWith` once that
// many chunks have been served (simulates a mid-stream abort/network drop).
function sseResponse(lines: string[], opts?: { failAfter: number; failWith: Error }): Response {
  const enc = new TextEncoder()
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (opts && i >= opts.failAfter) throw opts.failWith
          if (i < lines.length) return { done: false, value: enc.encode(lines[i++] + '\n') }
          return { done: true, value: undefined }
        }
      })
    }
  } as unknown as Response
}

const abortError = (): Error => {
  const e = new Error('This operation was aborted')
  e.name = 'AbortError'
  return e
}

// Streamed chunks emitted for an apiSend instance, joined.
const streamed = (): string =>
  vi
    .mocked(appState.send)
    .mock.calls.filter((c) => c[0] === CH.apiStream)
    .map((c) => c[2] as string)
    .join('')

const usageSends = (): unknown[] =>
  vi
    .mocked(appState.send)
    .mock.calls.filter((c) => c[0] === CH.usage)
    .map((c) => c[2])

describe('OpenAIClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProvider).mockResolvedValue({
      id: 'prov',
      name: 'TestProv',
      baseUrl: 'http://api.test/v1',
      defaultModel: 'm-default'
    } as never)
    vi.mocked(getKey).mockResolvedValue('sk-test')
    vi.mocked(capReached).mockReturnValue(false)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('apiComplete retry/backoff', () => {
    it('retries a 500 and returns the successful response', async () => {
      vi.useFakeTimers()
      fetchMock.mockResolvedValueOnce(errRes(500)).mockResolvedValueOnce(okJson('answer'))
      const p = apiComplete('prov', 'm1', HISTORY)
      await vi.runAllTimersAsync()
      await expect(p).resolves.toBe('answer')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('retries a thrown network error and recovers', async () => {
      vi.useFakeTimers()
      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(okJson('recovered'))
      const p = apiComplete('prov', 'm1', HISTORY)
      await vi.runAllTimersAsync()
      await expect(p).resolves.toBe('recovered')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('fails fast on a non-retryable 4xx (single attempt)', async () => {
      fetchMock.mockResolvedValue(errRes(401, 'bad key'))
      await expect(apiComplete('prov', 'm1', HISTORY)).rejects.toThrow('TestProv 401: bad key')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('gives up after exhausting retries on persistent 429', async () => {
      vi.useFakeTimers()
      fetchMock.mockResolvedValue(errRes(429, 'rate limited'))
      const p = apiComplete('prov', 'm1', HISTORY)
      // Attach the rejection handler before advancing timers so the rejection
      // is never unhandled.
      const assertion = expect(p).rejects.toThrow('TestProv 429: rate limited')
      await vi.runAllTimersAsync()
      await assertion
      // 1 initial attempt + 2 retries = 3 total
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('never retries an aborted request', async () => {
      fetchMock.mockRejectedValue(abortError())
      await expect(apiComplete('prov', 'm1', HISTORY)).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('apiSend streaming', () => {
    it('streams content, reports usage, and terminates with the done sentinel', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse([
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
          'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }),
          'data: [DONE]'
        ])
      )
      await apiSend('inst1', 'prov', 'm1', HISTORY)
      expect(streamed()).toContain('Hello')
      expect(streamed()).toContain('[[api:done]]')
      expect(usageSends()).toEqual([{ promptTokens: 7, completionTokens: 3 }])
      expect(addUsageCost).toHaveBeenCalledWith('m1', 7, 3)
    })

    it('surfaces a transport failure (after retries) as an inline error, no usage', async () => {
      vi.useFakeTimers()
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      const p = apiSend('inst1', 'prov', 'm1', HISTORY)
      await vi.runAllTimersAsync()
      await p
      expect(fetchMock).toHaveBeenCalledTimes(3) // all retries consumed
      expect(streamed()).toContain('[API error: fetch failed]')
      expect(streamed()).toContain('[[api:done]]') // panel still unblocked
      expect(usageSends()).toEqual([])
    })

    it('surfaces a non-ok HTTP response as an inline error', async () => {
      fetchMock.mockResolvedValueOnce(errRes(400, 'bad request'))
      await apiSend('inst1', 'prov', 'm1', HISTORY)
      expect(streamed()).toContain('[API error 400: bad request]')
      expect(usageSends()).toEqual([])
    })

    it('still reports usage captured before a later turn fails', async () => {
      // Turn 1: model requests a tool and the provider reports usage.
      fetchMock
        .mockResolvedValueOnce(
          sseResponse([
            'data: ' +
              JSON.stringify({
                choices: [
                  { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{}' } }] } }
                ]
              }),
            'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })
          ])
        )
        // Turn 2 (after the tool result is fed back) fails outright.
        .mockResolvedValueOnce(errRes(400, 'context too long'))
      await apiSend('inst1', 'prov', 'm1', HISTORY)
      expect(execTool).toHaveBeenCalledWith('read_file', {}, 'api', 'api', undefined)
      expect(streamed()).toContain('[API error 400: context too long]')
      // Usage from the successful first turn is not lost.
      expect(usageSends()).toEqual([{ promptTokens: 5, completionTokens: 2 }])
    })

    it('reports an unknown provider without fetching', async () => {
      vi.mocked(getProvider).mockResolvedValue(null as never)
      await apiSend('inst1', 'nope', 'm1', HISTORY)
      expect(streamed()).toContain('[API: unknown provider nope]')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('apiCompleteAgentic abort + cap', () => {
    const policy = {} as ApprovalPolicy

    it('propagates a mid-stream abort instead of swallowing it', async () => {
      fetchMock.mockResolvedValueOnce(
        sseResponse(['data: ' + JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })], {
          failAfter: 1,
          failWith: abortError()
        })
      )
      await expect(apiCompleteAgentic('prov', 'm1', HISTORY, policy)).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetchMock).toHaveBeenCalledTimes(1) // aborts are never retried
    })

    it('propagates an abort thrown by fetch itself without retrying', async () => {
      fetchMock.mockRejectedValue(abortError())
      await expect(apiCompleteAgentic('prov', 'm1', HISTORY, policy)).rejects.toMatchObject({ name: 'AbortError' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('stops before fetching when the session cost cap is reached', async () => {
      vi.mocked(capReached).mockReturnValue(true)
      const out = await apiCompleteAgentic('prov', 'm1', HISTORY, policy)
      expect(out).toBe('[blocked: session cost cap reached]')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
