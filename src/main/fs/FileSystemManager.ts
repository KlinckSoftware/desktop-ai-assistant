import { promises as fs } from 'fs'
import { join, basename, resolve, sep } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { appState } from '../state'
import { CH, type FileNode } from '../../shared/types'

const IGNORE = new Set(['node_modules', '.git', 'out', 'dist', 'release', '.next', '.cache'])

// Extensions we refuse to load as text (would render garbage and corrupt on save).
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'tif', 'tiff', 'svg',
  'pdf', 'zip', 'gz', 'tar', '7z', 'rar', 'jar', 'war',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'wasm',
  'mp3', 'wav', 'ogg', 'flac', 'mp4', 'mov', 'avi', 'mkv', 'webm',
  'db', 'sqlite', 'sqlite3', 'lock', 'woff', 'woff2', 'ttf', 'otf', 'eot'
])

function isBinaryPath(p: string): boolean {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  return BINARY_EXT.has(ext)
}

// Confine file reads/writes to the current project root. Blocks path-traversal
// (`..`) and absolute paths outside the project — so a compromised renderer
// can't read ~/.ssh or overwrite system files.
function assertInRoot(p: string): string {
  const root = resolve(appState.projectRoot)
  const target = resolve(p)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Path outside project root: ${p}`)
  }
  return target
}

export class FileSystemManager {
  private watcher: FSWatcher | null = null

  async readTree(root: string, depth = 4): Promise<FileNode> {
    return this.buildNode(root, depth)
  }

  private async buildNode(path: string, depth: number): Promise<FileNode> {
    const name = basename(path) || path
    let stat
    try {
      stat = await fs.stat(path)
    } catch {
      return { name, path, isDir: false }
    }
    if (!stat.isDirectory()) return { name, path, isDir: false }

    const node: FileNode = { name, path, isDir: true, children: [] }
    if (depth <= 0) return node

    let entries: string[] = []
    try {
      entries = await fs.readdir(path)
    } catch {
      return node
    }

    const children = await Promise.all(
      entries
        .filter((e) => !IGNORE.has(e) && !e.startsWith('.'))
        .sort()
        .map((e) => this.buildNode(join(path, e), depth - 1))
    )
    // Dirs first, then files, each alphabetical.
    node.children = children.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    )
    return node
  }

  // Flat list of relative file paths under root (for @-mention autocomplete).
  async listFiles(root: string, max = 5000): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= max) return
      let entries: import('fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= max) return
        if (IGNORE.has(e.name) || e.name.startsWith('.')) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else out.push(resolve(full).slice(resolve(root).length + 1).split('\\').join('/'))
      }
    }
    await walk(root)
    return out
  }

  // Plain substring search across project files (for the search_code tool).
  // Returns matching `rel:line: text` lines, capped. Binaries are skipped.
  async search(root: string, query: string, max = 80): Promise<string[]> {
    const q = query.toLowerCase()
    const files = await this.listFiles(root, 4000)
    const hits: string[] = []
    for (const rel of files) {
      if (hits.length >= max) break
      let buf: Buffer
      try {
        buf = await fs.readFile(join(root, rel))
      } catch {
        continue
      }
      if (buf.subarray(0, 4000).includes(0)) continue // binary
      const lines = buf.toString('utf-8').split('\n')
      for (let i = 0; i < lines.length && hits.length < max; i++) {
        if (lines[i].toLowerCase().includes(q)) hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
      }
    }
    return hits
  }

  // --- Drag-and-drop helpers (operate on user-dropped paths, NOT confined to
  // the project root — dropping is an explicit user action). ---

  async classifyDropped(p: string): Promise<{ kind: 'dir' | 'image' | 'text'; name: string }> {
    const name = basename(p)
    try {
      const st = await fs.stat(p)
      if (st.isDirectory()) return { kind: 'dir', name }
    } catch {
      return { kind: 'text', name }
    }
    const ext = p.split('.').pop()?.toLowerCase() ?? ''
    const imageExt = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
    return { kind: imageExt.has(ext) ? 'image' : 'text', name }
  }

  async readDropped(p: string): Promise<string> {
    const buf = await fs.readFile(p)
    if (buf.subarray(0, 8000).includes(0)) throw new Error(`Binary file: ${basename(p)}`)
    return buf.toString('utf-8')
  }

  async readImage(p: string): Promise<{ mime: string; base64: string }> {
    const ext = p.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml'
    }
    const buf = await fs.readFile(p)
    return { mime: mimeMap[ext] ?? 'application/octet-stream', base64: buf.toString('base64') }
  }

  async readFile(path: string): Promise<string> {
    const abs = assertInRoot(path)
    if (isBinaryPath(abs)) throw new Error(`Cannot display binary file: ${basename(abs)}`)
    const buf = await fs.readFile(abs)
    // Sniff the first chunk for NUL bytes — catches binaries with unknown/no ext.
    if (buf.subarray(0, 8000).includes(0)) {
      throw new Error(`Cannot display binary file: ${basename(abs)}`)
    }
    return buf.toString('utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    const abs = assertInRoot(path)
    if (isBinaryPath(abs)) throw new Error(`Refusing to write binary file: ${basename(abs)}`)
    await fs.writeFile(abs, content, 'utf-8')
  }

  watch(root: string): void {
    this.watcher?.close()
    this.watcher = chokidar.watch(root, {
      ignored: (p) => [...IGNORE].some((i) => p.includes(`${i}`)),
      ignoreInitial: true,
      ignorePermissionErrors: true,
      followSymlinks: false,
      depth: 4
    })
    const notify = (): void => appState.send(CH.fsChanged, root)
    this.watcher
      .on('add', notify)
      .on('unlink', notify)
      .on('addDir', notify)
      .on('unlinkDir', notify)
      // Swallow EPERM/ENOENT on junctions instead of crashing with an unhandled rejection.
      .on('error', (err) => console.warn('[fs-watch]', (err as Error)?.message ?? err))
  }

  dispose(): void {
    this.watcher?.close()
    this.watcher = null
  }
}
