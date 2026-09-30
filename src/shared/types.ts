// Types shared by the main process and the renderer.
import type { Environment } from '../core/model'

export interface EnvironmentDraft {
  environment: Environment
  /** Local values of the variables listed in `environment.secrets`. */
  secretValues: Record<string, string>
  /** Stored secrets exist but cannot be decrypted (the OS keyring key changed). */
  secretsUnreadable: boolean
}

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

export interface AppSettings {
  /** Accept invalid TLS certificates (self-signed development servers). */
  insecureTls: boolean
}
