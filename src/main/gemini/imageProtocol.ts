// Registers the app-image:// protocol used to display Imagen-generated PNGs in
// the renderer without exposing the filesystem (no file:// / nodeIntegration).
// The renderer only ever sees a bare filename (e.g. `img_123_abc.png`); this
// module resolves it against the generated-images dir and refuses to serve
// anything that resolves outside of it (path-traversal-proof).

import { protocol, net } from 'electron'
import { join, resolve, sep } from 'path'
import { pathToFileURL } from 'url'

export const IMAGE_PROTOCOL = 'app-image'

/**
 * Resolve a requested (possibly hostile) filename against `baseDir`, returning
 * the absolute path only if it stays confined to `baseDir`. Pure + testable —
 * no Electron/fs dependency.
 */
export function resolveConfinedImagePath(baseDir: string, requested: string): string | null {
  // Strip any path separators/traversal from the requested name — we only ever
  // want a bare filename, but resolve() is the real guard below.
  const candidate = resolve(join(baseDir, requested))
  const base = resolve(baseDir)
  const withSep = base.endsWith(sep) ? base : base + sep
  if (candidate !== base && !candidate.startsWith(withSep)) return null
  return candidate
}

/**
 * Declare app-image:// as a privileged (standard + secure + fetch-able) scheme.
 * MUST be called before app.whenReady() — Electron ignores this after the app
 * is ready. Lets <img src="app-image://…"> load like a normal same-origin image.
 */
export function registerImageSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false, corsEnabled: true }
    }
  ])
}

/** Register the app-image:// handler. Call after app is ready, before window creation. */
export function registerImageProtocol(imagesDir: string): void {
  protocol.handle(IMAGE_PROTOCOL, (request) => {
    const url = new URL(request.url)
    // app-image://<filename> — host is empty, filename lands in pathname (host-less scheme).
    const raw = decodeURIComponent((url.hostname + url.pathname).replace(/^\/+/, ''))
    const resolved = resolveConfinedImagePath(imagesDir, raw)
    if (!resolved) {
      return new Response('not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(resolved).toString())
  })
}
