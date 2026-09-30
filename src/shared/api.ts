// IPC contract shared by the main process, the preload script and the renderer.
//
// Every method takes a single object argument (validated with zod in main) and
// is exposed on channel `${domain}:${method}`.
import type { ConflictChoice, SyncStatus, WorkspaceRepo, WorkspaceState } from './types'

export interface AppInfo {
  version: string
  platform: string
  /** False when secrets are only obfuscated (no OS keyring). */
  secretsEncrypted: boolean
}

export interface Api {
  workspace: {
    state(): Promise<WorkspaceState>
    clone(args: { name: string; remoteUrl: string; path?: string }): Promise<WorkspaceRepo>
    open(args: { name: string; path: string }): Promise<WorkspaceRepo>
    create(args: { name: string; path?: string }): Promise<WorkspaceRepo>
    rename(args: { repoId: string; name: string }): Promise<WorkspaceState>
    remove(args: { repoId: string; deleteFiles: boolean }): Promise<WorkspaceState>
    activate(args: { repoId: string }): Promise<WorkspaceState>
    setRemote(args: { repoId: string; remoteUrl: string }): Promise<WorkspaceRepo>
    status(args: { repoId: string }): Promise<SyncStatus>
    sync(args: { repoId: string }): Promise<SyncStatus>
    resolveConflicts(args: { repoId: string; choices: Record<string, ConflictChoice> }): Promise<SyncStatus>
  }
  dialog: {
    openDirectory(args: { title: string }): Promise<string | null>
  }
  app: {
    info(): Promise<AppInfo>
  }
}

/** Events pushed from the main process. */
export interface ApiEvents {
  'workspace:status': SyncStatus
  'workspace:changed': WorkspaceState
}

export const API_EVENTS: (keyof ApiEvents)[] = ['workspace:status', 'workspace:changed']

/** Method names per domain, used by the preload script to build the bridge. */
export const API_METHODS: { [D in keyof Api]: (keyof Api[D])[] } = {
  workspace: ['state', 'clone', 'open', 'create', 'rename', 'remove', 'activate', 'setRemote', 'status', 'sync', 'resolveConflicts'],
  dialog: ['openDirectory'],
  app: ['info']
}

export interface Bridge {
  api: Api
  on<E extends keyof ApiEvents>(event: E, listener: (payload: ApiEvents[E]) => void): () => void
}

/** Error message format used across IPC: Electron prefixes errors, the renderer strips it. */
export function cleanIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
