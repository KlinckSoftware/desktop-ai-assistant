import { spawn } from 'child_process'

const IS_WIN = process.platform === 'win32'
const CLAUDE_BIN = IS_WIN ? 'claude.cmd' : 'claude'

// One-shot, non-interactive Claude Code call via `claude -p`.
// Used by the debate moderator to get a clean text response (the interactive
// pty is a TUI and not suitable for capturing discrete replies).
export function claudeOneShot(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ['-p', prompt], {
      cwd,
      env: process.env,
      shell: IS_WIN // resolve .cmd shim on Windows
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`claude -p exited ${code}: ${err.slice(0, 500)}`))
    })
  })
}
