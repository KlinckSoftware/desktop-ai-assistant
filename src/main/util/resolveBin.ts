import { existsSync } from 'fs'
import { join, delimiter } from 'path'

const IS_WIN = process.platform === 'win32'
// On Windows a CLI may be installed as any of these.
const WIN_EXTS = ['.exe', '.cmd', '.bat', '.com', '']

// Resolve a command name to a full executable path by scanning PATH.
// node-pty on Windows needs an exact file (it won't apply PATHEXT), so we
// probe each extension. Falls back to the bare name if nothing is found.
export function resolveBin(name: string): string {
  const paths = (process.env.PATH || '').split(delimiter).filter(Boolean)
  const exts = IS_WIN ? WIN_EXTS : ['']
  for (const dir of paths) {
    for (const ext of exts) {
      const full = join(dir, name + ext)
      if (existsSync(full)) return full
    }
  }
  return IS_WIN ? `${name}.exe` : name
}

// Env for spawning `claude`, with nesting markers removed. The CLI refuses to
// launch inside another Claude Code session (CLAUDECODE / CLAUDE_CODE_* set);
// stripping these lets our app spawn it cleanly even when launched from one.
export function cleanClaudeEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE')) continue
    env[k] = v
  }
  return env
}
