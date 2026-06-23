import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

// appState pulls in electron; stub it with a temp project root + the one setting
// FileSystemManager reads (allowProtectedWrites).
const st = vi.hoisted(() => ({
  appState: { projectRoot: '', settings: { allowProtectedWrites: false }, send: () => {} }
}))
vi.mock('../state', () => ({ appState: st.appState }))

import { FileSystemManager } from './FileSystemManager'

let tmp: string
const fsm = new FileSystemManager()

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dai-fsm-'))
  st.appState.projectRoot = tmp
  mkdirSync(join(tmp, '.git', 'hooks'), { recursive: true })
  writeFileSync(join(tmp, 'a.ts'), 'const x = 1 // findme\n')
  writeFileSync(join(tmp, '.env'), 'SECRET=hunter2\n')
})
afterEach(() => {
  st.appState.settings.allowProtectedWrites = false
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('FileSystemManager — confinement', () => {
  it('reads back what it writes inside the root', async () => {
    await fsm.writeFile(join(tmp, 'w.txt'), 'hi')
    expect(await fsm.readFile(join(tmp, 'w.txt'))).toBe('hi')
  })

  it('blocks path traversal / escapes outside the project root', async () => {
    await expect(fsm.writeFile(resolve(tmp, '..', 'evil.txt'), 'x')).rejects.toThrow(/outside project root/i)
    await expect(fsm.readFile(resolve(tmp, '..', '..', 'etc', 'passwd'))).rejects.toThrow(/outside project root/i)
  })

  it('refuses writes into .git/ unless allowProtectedWrites is on', async () => {
    await expect(fsm.writeFile(join(tmp, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n')).rejects.toThrow(/protected/i)
    st.appState.settings.allowProtectedWrites = true
    await expect(fsm.writeFile(join(tmp, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n')).resolves.toBeUndefined()
  })

  it('refuses to write binary file types', async () => {
    await expect(fsm.writeFile(join(tmp, 'img.png'), 'data')).rejects.toThrow(/binary/i)
  })

  it('does NOT secret-guard the editor read path (that guard is tool-only)', async () => {
    expect(await fsm.readFile(join(tmp, '.env'))).toContain('SECRET=hunter2')
  })

  it('lists files and searches contents', async () => {
    const files = await fsm.listFiles(tmp)
    expect(files).toContain('a.ts')
    expect(files).not.toContain('.env') // dotfiles excluded from the listing
    const hits = await fsm.search(tmp, 'findme')
    expect(hits.some((h) => h.startsWith('a.ts:'))).toBe(true)
  })
})
