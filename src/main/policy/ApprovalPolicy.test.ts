import { describe, it, expect } from 'vitest'
import { decide } from './ApprovalPolicy'

describe('ApprovalPolicy.decide', () => {
  it('always defers to the human in interactive mode', () => {
    expect(decide({ mode: 'interactive' }, 'run_command', 'rm -rf /')).toEqual({ action: 'interactive' })
  })

  it('never executes in dry-run mode', () => {
    expect(decide({ mode: 'dryrun', allow: ['run_command'] }, 'run_command', 'ls')).toEqual({ action: 'dryrun' })
  })

  it('autonomous: runs an allowlisted, non-dangerous command', () => {
    expect(decide({ mode: 'autonomous', allow: ['run_command'] }, 'run_command', 'ls -la')).toEqual({ action: 'run' })
  })

  it('autonomous: BLOCKS a dangerous command even when the capability is allowlisted', () => {
    const d = decide({ mode: 'autonomous', allow: ['run_command'] }, 'run_command', 'taskkill /F /IM electron.exe')
    expect(d.action).toBe('block')
    expect(d).toHaveProperty('reason')
  })

  it('autonomous: blocks a capability not in the allowlist', () => {
    const d = decide({ mode: 'autonomous', allow: ['read_file'] }, 'run_command', 'ls')
    expect(d.action).toBe('block')
  })

  it('autonomous: runs an allowlisted tool with no command (e.g. read_file)', () => {
    expect(decide({ mode: 'autonomous', allow: ['read_file'] }, 'read_file')).toEqual({ action: 'run' })
  })

  it('autonomous: empty/absent allowlist blocks everything', () => {
    expect(decide({ mode: 'autonomous' }, 'read_file').action).toBe('block')
    expect(decide({ mode: 'autonomous', allow: [] }, 'read_file').action).toBe('block')
  })
})
