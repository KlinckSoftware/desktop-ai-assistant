// Heuristic denylist for shell commands that should ALWAYS require explicit
// approval, even in a "trusted" session. Defense against prompt-injection
// steering an agent into destructive or exfiltrating commands.
//
// Intentionally conservative — false positives just mean an extra confirm,
// which is the safe direction.

const DANGEROUS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, reason: 'recursive force delete' },
  { re: /\bRemove-Item\b.*-Recurse|\bRemove-Item\b.*-Force/i, reason: 'recursive/force delete' },
  { re: /\b(rmdir|rd)\s+\/s|\bdel\s+\/[a-z]/i, reason: 'recursive delete' },
  { re: /\b(format|mkfs|diskpart)\b/i, reason: 'disk format' },
  { re: /\bdd\s+if=/i, reason: 'raw disk write' },
  { re: /:\s*\(\s*\)\s*\{/, reason: 'fork bomb' },
  { re: /\b(curl|wget|iwr|Invoke-WebRequest|Invoke-Expression|iex)\b/i, reason: 'network fetch/exec' },
  { re: /\|\s*(sh|bash|pwsh|powershell|python|node)\b/i, reason: 'pipe to interpreter' },
  { re: /\bsudo\b|\brunas\b/i, reason: 'privilege escalation' },
  { re: /\bchmod\s+777|\bchmod\s+-R/i, reason: 'broad permission change' },
  { re: /\b(shutdown|reboot|halt|Stop-Computer|Restart-Computer)\b/i, reason: 'power control' },
  { re: /\btaskkill\b|\bStop-Process\b|\bpkill\b|\bkillall\b|\bkill\s+-/i, reason: 'kills processes (can kill this app)' },
  { re: /\breg\s+(delete|add)\b|\bSet-ItemProperty\b.*HK/i, reason: 'registry write' },
  { re: /\bgit\s+push\b/i, reason: 'pushes to remote' },
  { re: /\bnpm\s+publish\b|\byarn\s+publish\b/i, reason: 'publishes package' },
  { re: />\s*\/(etc|dev|sys|usr|bin)\b/i, reason: 'write to system path' },
  { re: /\b(ssh|scp|rsync)\b/i, reason: 'remote transfer' },
  { re: /\.aws\/credentials|\.ssh\/id_|\.env\b|\bsecrets?\b/i, reason: 'touches credentials/secrets' }
]

export interface DangerVerdict {
  dangerous: boolean
  reason?: string
}

export function checkDangerous(command: string): DangerVerdict {
  for (const { re, reason } of DANGEROUS) {
    if (re.test(command)) return { dangerous: true, reason }
  }
  return { dangerous: false }
}
