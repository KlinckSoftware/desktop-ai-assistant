// Path classification shared by main + tests. Two concerns:
//  - protected paths: must never be WRITTEN by an agent/tool (writing .git/hooks
//    would execute on the next git op, bypassing the shell denylist).
//  - secret paths: should not be READ by a tool and shipped to a provider
//    (credentials, keys, .env). The editor UI may still open them on explicit
//    user action — only the tool/agent read path is guarded.
//
// Matching is on the forward-slash relative path's segments, so it is OS-agnostic
// and resists `.git/../.git` style tricks (callers resolve to an absolute path
// first, then pass the root-relative form).

const PROTECTED_SEGMENTS = ['.git', 'node_modules']

/** Split a relative path into clean, forward-slash segments (drops '', '.'). */
export function segments(rel: string): string[] {
  return rel
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
}

/** True if any path segment is a protected dir (.git, node_modules). */
export function isProtectedPath(rel: string): boolean {
  return segments(rel).some((s) => PROTECTED_SEGMENTS.includes(s))
}

// Secret-looking files: credentials, private keys, dotenv, cloud/ssh dirs.
const SECRET_DIR_SEGMENTS = ['.ssh', '.aws', '.gnupg']
const SECRET_FILE_RES: RegExp[] = [
  /^\.env(\..+)?$/i, // .env, .env.local, .env.production
  /^id_(rsa|ed25519|ecdsa|dsa)$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.p12$/i,
  /^credentials$/i,
  /(^|[._-])secret(s)?([._-]|$)/i
]

/** True if a relative path looks like a secret/credential file or lives in a
 *  secret directory. */
export function isSecretPath(rel: string): boolean {
  const segs = segments(rel)
  if (segs.some((s) => SECRET_DIR_SEGMENTS.includes(s))) return true
  const name = segs[segs.length - 1] ?? ''
  return SECRET_FILE_RES.some((re) => re.test(name))
}
