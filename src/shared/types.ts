// Types shared by the main process and the renderer.

/** A workspace: a git repository (or a plain folder) holding collections. */
export interface WorkspaceRepo {
  id: string
  name: string
  /** Absolute path of the local clone. */
  path: string
  remoteUrl?: string
}

export interface WorkspaceState {
  repos: WorkspaceRepo[]
  activeRepoId: string | null
}

export interface SyncStatus {
  repoId: string
  isGitRepo: boolean
  hasRemote: boolean
  branch: string | null
  ahead: number
  behind: number
  dirty: boolean
  syncing: boolean
  /** Files in conflict with the remote after the last sync attempt. */
  conflicts: string[]
  lastSyncAt: number | null
  error: string | null
}

export type ConflictChoice = 'mine' | 'theirs'
