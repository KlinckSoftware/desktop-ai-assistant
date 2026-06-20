import { spawn } from 'child_process'
import { resolveBin, cleanClaudeEnv } from '../util/resolveBin'

const CLAUDE_BIN = resolveBin('claude')

// One-shot, non-interactive Claude Code call via `claude -p`.
// Used by the debate moderator to get a clean text response (the interactive
// pty is a TUI and not suitable for capturing discrete replies).
export function claudeOneShot(prompt: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(CLAUDE_BIN, ['-p', prompt], {
      cwd,
      env: cleanClaudeEnv(),
      // stdin = 'ignore' gives Claude immediate EOF; otherwise it waits ~3s for
      // piped stdin and exits 1. The prompt is passed via the -p arg.
      stdio: ['ignore', 'pipe', 'pipe'],
      // CLAUDE_BIN is a fully-resolved path; no shell needed (avoids arg-quoting issues).
      shell: false
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      // Claude writes some failures (e.g. auth 401) to stdout, not stderr —
      // include both so the reason isn't blank.
      else reject(new Error(`claude -p exited ${code}: ${(err || out).slice(0, 500).trim()}`))
    })
  })
}
