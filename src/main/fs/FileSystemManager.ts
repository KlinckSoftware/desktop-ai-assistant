import { promises as fs } from 'fs'
import { join, basename } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { appState } from '../state'
import { CH, type FileNode } from '../../shared/types'

const IGNORE = new Set(['node_modules', '.git', 'out', 'dist', 'release', '.next', '.cache'])

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

  async readFile(path: string): Promise<string> {
    return fs.readFile(path, 'utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    await fs.writeFile(path, content, 'utf-8')
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
