import { describe, it, expect } from 'vitest'
import { decide, policyForStep } from './ApprovalPolicy'

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

  it("wildcard '*' allows any capability but still blocks dangerous commands", () => {
    expect(decide({ mode: 'autonomous', allow: ['*'] }, 'some__mcp_tool').action).toBe('run')
    expect(decide({ mode: 'autonomous', allow: ['*'] }, 'run_command', 'ls').action).toBe('run')
    expect(decide({ mode: 'autonomous', allow: ['*'] }, 'run_command', 'rm -rf /').action).toBe('block')
  })
})

describe('policyForStep', () => {
  it('dry-run overrides the preset', () => {
    expect(policyForStep('full', true)).toEqual({ mode: 'dryrun' })
  })

  it('read-only allows reads, blocks edits and commands', () => {
    const p = policyForStep('read-only', false)
    expect(decide(p, 'read_file').action).toBe('run')
    expect(decide(p, 'apply_edit').action).toBe('block')
    expect(decide(p, 'run_command', 'ls').action).toBe('block')
  })

  it('edit allows reads + edits, blocks run_command', () => {
    const p = policyForStep('edit', false)
    expect(decide(p, 'write_file').action).toBe('run')
    expect(decide(p, 'apply_edit').action).toBe('run')
    expect(decide(p, 'run_command', 'ls').action).toBe('block')
  })

  it('full WITHOUT opt-in is downgraded to edit (no autonomous shell)', () => {
    const p = policyForStep('full', false) // allowFull defaults to false
    expect(decide(p, 'write_file').action).toBe('run') // edits still allowed
    expect(decide(p, 'run_command', 'npm test').action).toBe('block') // shell denied
    expect(decide(p, 'srv__tool').action).toBe('block') // wildcard not granted
  })

  it('full WITH opt-in allows commands (still dangerous-gated) and MCP tools', () => {
    const p = policyForStep('full', false, true)
    expect(decide(p, 'run_command', 'npm test').action).toBe('run')
    expect(decide(p, 'srv__tool').action).toBe('run')
    expect(decide(p, 'run_command', 'git push').action).toBe('block')
  })
})
