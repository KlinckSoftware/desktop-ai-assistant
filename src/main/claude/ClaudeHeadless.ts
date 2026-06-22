import { spawn } from 'child_process'
import { resolveBin, cleanClaudeEnv } from '../util/resolveBin'

const CLAUDE_BIN = resolveBin('claude')

// One-shot, non-interactive Claude Code call via `claude -p`.
// Used by the debate moderator to get a clean text response (the interactive
// pty is a TUI and not suitable for capturing discrete replies).
export function claudeOneShot(
  prompt: string,
  cwd: string,
  model?: string,
  effort?: string,
  allowedTools?: string[],
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const args = ['-p', prompt]
    if (model) args.push('--model', model)
    if (effort) args.push('--effort', effort)
    // Constrain which tools Claude may use (pipeline steps). With --allowedTools
    // set, only listed tools are pre-approved; anything else is denied under -p.
    if (allowedTools && allowedTools.length) args.push('--allowedTools', ...allowedTools)
    const proc = spawn(CLAUDE_BIN, args, {
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
    let aborted = false
    const onAbort = (): void => {
      aborted = true
      try {
        proc.kill()
      } catch {
        /* already gone */
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (aborted) return reject(abortError())
      if (code === 0) resolve(out.trim())
      // Claude writes some failures (e.g. auth 401) to stdout, not stderr —
      // include both so the reason isn't blank.
      else reject(new Error(`claude -p exited ${code}: ${(err || out).slice(0, 500).trim()}`))
    })
  })
}

// A DOMException-shaped AbortError, matching what fetch throws on abort, so all
// cancel paths can be detected uniformly via `err.name === 'AbortError'`.
function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}
