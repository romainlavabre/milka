// Watches the active workspace folder, so changes made outside the app (MCP
// server, text editor, git in a terminal) show up without a restart.
import { watch, type FSWatcher } from 'node:fs'

const DEBOUNCE_MS = 300

export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | undefined
  private watched: string | null = null

  constructor(private readonly onChange: (repoId: string) => void) {}

  /** Watches `path` for the workspace `repoId`, replacing the previous one. */
  watch(repoId: string | null, path: string | null): void {
    if (path === this.watched) return
    this.close()
    if (!repoId || !path) return
    this.watched = path
    try {
      this.watcher = watch(path, { recursive: true }, (_event, file) => {
        if (file && (file === '.git' || file.startsWith('.git/'))) return
        clearTimeout(this.timer)
        this.timer = setTimeout(() => this.onChange(repoId), DEBOUNCE_MS)
      })
      this.watcher.on('error', () => this.close())
    } catch {
      // A folder that cannot be watched only loses live refresh.
      this.watcher = null
    }
  }

  close(): void {
    clearTimeout(this.timer)
    this.watcher?.close()
    this.watcher = null
    this.watched = null
  }
}
