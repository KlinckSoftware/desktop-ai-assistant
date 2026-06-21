import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Unique temp userData dir; electron.app.getPath is mocked to return it.
const TMP = vi.hoisted(() => require('path').join(require('os').tmpdir(), `reg-test-${process.pid}`))

vi.mock('electron', () => ({ app: { getPath: () => TMP } }))
// findBin: only 'claude' resolves on PATH for these tests.
vi.mock('../util/resolveBin', () => ({
  findBin: (name: string) => (name === 'claude' ? '/usr/bin/claude' : null)
}))

import { listAgents, saveAgent, removeAgent } from './registry'

const cfg = join(TMP, 'agents.json')
async function writeConfig(agents: Record<string, unknown>): Promise<void> {
  await fs.writeFile(cfg, JSON.stringify({ agents }), 'utf-8')
}

beforeEach(async () => {
  await fs.mkdir(TMP, { recursive: true })
  await writeConfig({})
})
afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true })
})

describe('registry listAgents', () => {
  it('returns built-ins and marks availability via findBin', async () => {
    const list = await listAgents()
    const byId = Object.fromEntries(list.map((a) => [a.id, a]))
    expect(byId.claude).toBeTruthy()
    expect(byId.claude.available).toBe(true) // mocked on PATH
    expect(byId.gemini.available).toBe(false) // not on PATH
    expect(byId.claude.builtin).toBe(true)
  })

  it('merges user overrides over built-ins', async () => {
    await writeConfig({ claude: { name: 'My Claude', command: 'claude-wrapper' } })
    const claude = (await listAgents()).find((a) => a.id === 'claude')!
    expect(claude.name).toBe('My Claude')
    expect(claude.command).toBe('claude-wrapper')
    expect(claude.builtin).toBe(true) // still a built-in id
  })

  it('adds a brand-new user agent (not builtin)', async () => {
    await writeConfig({ mybot: { name: 'My Bot', command: 'mybot', args: ['--x'] } })
    const bot = (await listAgents()).find((a) => a.id === 'mybot')!
    expect(bot.name).toBe('My Bot')
    expect(bot.args).toEqual(['--x'])
    expect(bot.builtin).toBe(false)
  })
})

describe('registry save/remove', () => {
  it('saveAgent persists and appears in the list', async () => {
    const list = await saveAgent({ id: 'zed', name: 'Zed', command: 'zed', args: [] })
    expect(list.find((a) => a.id === 'zed')?.name).toBe('Zed')
    const onDisk = JSON.parse(await fs.readFile(cfg, 'utf-8'))
    expect(onDisk.agents.zed.command).toBe('zed')
  })

  it('removeAgent drops a user agent; built-in id reverts to default', async () => {
    await saveAgent({ id: 'claude', name: 'Override', command: 'x', args: [] })
    const after = await removeAgent('claude')
    expect(after.find((a) => a.id === 'claude')?.name).toBe('Claude Code') // default restored
  })
})
