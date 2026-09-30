// IPC contract shared by the main process, the preload script and the renderer.
//
// Every method takes a single object argument (validated with zod in main) and
// is exposed on channel `${domain}:${method}`.
import type { Collection, CollectionSummary, Environment, EnvironmentSummary, Folder, HttpRequest } from '../core/model'
import type { CookieInfo, ExecutionResult, RunCase, RunSummary } from '../core/results'
import type { AppSettings, ConflictChoice, EnvironmentDraft, SyncStatus, UpdateStatus, WorkspaceRepo, WorkspaceState } from './types'

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
  /** Content of the active workspace. `collection` is a collection slug, `path` a node path inside it. */
  collections: {
    list(): Promise<CollectionSummary[]>
    get(args: { collection: string }): Promise<Collection>
    /** Creates (collection null) or updates a collection; returns its slug. */
    save(args: { collection: string | null; data: Collection }): Promise<string>
    remove(args: { collection: string }): Promise<void>
    getFolder(args: { collection: string; path: string }): Promise<Folder>
    saveFolder(args: { collection: string; parent: string; path: string | null; data: Folder }): Promise<string>
    removeFolder(args: { collection: string; path: string }): Promise<void>
    getRequest(args: { collection: string; path: string }): Promise<HttpRequest>
    saveRequest(args: { collection: string; parent: string; path: string | null; data: HttpRequest }): Promise<string>
    duplicateRequest(args: { collection: string; path: string }): Promise<string>
    removeRequest(args: { collection: string; path: string }): Promise<void>
    /** Moves a node into `parent`, before the sibling `before` (at the end when null). */
    move(args: { collection: string; from: string; parent: string; before: string | null }): Promise<string>
    /** Variable names known in a collection (for script autocompletion). */
    variableNames(args: { collection: string }): Promise<string[]>
  }
  environments: {
    list(args: { collection: string }): Promise<EnvironmentSummary[]>
    get(args: { collection: string; env: string }): Promise<EnvironmentDraft>
    save(args: { collection: string; env: string | null; data: Environment; secretValues: Record<string, string> }): Promise<string>
    remove(args: { collection: string; env: string }): Promise<void>
  }
  http: {
    /** Sends a request of the active workspace; `request` is the unsaved draft. */
    send(args: {
      requestId: string
      collection: string
      path: string
      request?: HttpRequest
      bodyName?: string | null
      env: string | null
    }): Promise<ExecutionResult>
    cancel(args: { requestId: string }): Promise<void>
    /** Variables set by scripts during this session. */
    runtimeVars(): Promise<Record<string, string>>
    clearRuntimeVars(): Promise<void>
    /** Cookies received during this session, in the active workspace. */
    cookies(): Promise<CookieInfo[]>
    deleteCookie(args: { domain: string; path: string; name: string }): Promise<void>
    clearCookies(): Promise<void>
  }
  importer: {
    /** A Bruno collection folder (`path`), or a Postman / OpenAPI file (`path`) or text (`text`). */
    collection(args: {
      format: 'bruno' | 'postman' | 'openapi'
      path?: string
      text?: string
    }): Promise<{ slug: string; requests: number; warnings: string[] }>
    /** A Postman environment file into a collection. */
    environment(args: { collection: string; path: string }): Promise<string>
    /** A cURL command as a new request; returns its path. */
    curl(args: { collection: string; parent: string; command: string }): Promise<string>
  }
  exporter: {
    /** Writes the collection as OpenAPI 3.1, YAML or JSON after the file extension. */
    openapi(args: { collection: string; file: string }): Promise<void>
  }
  runner: {
    /** Runs requests and their tests; cases are pushed with `runner:case` as they complete. */
    run(args: {
      runId: string
      collection: string
      path: string
      env: string | null
      allBodies: boolean
      bail: boolean
      tags: string[]
    }): Promise<RunSummary>
    cancel(args: { runId: string }): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    set(args: Partial<AppSettings>): Promise<AppSettings>
  }
  dialog: {
    openDirectory(args: { title: string }): Promise<string | null>
    openFile(args: { title: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
    saveFile(args: { title: string; defaultName: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>
  }
  app: {
    info(): Promise<AppInfo>
    /** Closes the window, once the renderer dealt with the unsaved changes. */
    close(): Promise<void>
  }
  update: {
    status(): Promise<UpdateStatus>
    /** Downloads and installs the latest version (a system window asks for the password of a .deb). */
    install(): Promise<void>
    /** Opens a terminal ready to run install.sh; `copied` when there was none and the command went to the clipboard. */
    openTerminal(): Promise<{ command: string; copied: boolean }>
    restart(): Promise<void>
  }
}

/** Events pushed from the main process. */
export interface ApiEvents {
  'workspace:status': SyncStatus
  'workspace:changed': WorkspaceState
  /** Files of the active workspace changed outside the app (MCP server, editor, git). */
  'workspace:files': { repoId: string }
  'runner:case': { runId: string; runCase: RunCase; index: number; total: number }
  'update:status': UpdateStatus
  /** The window is about to close: the renderer asks about unsaved changes, then calls app.close. */
  'app:close-requested': Record<string, never>
}

export const API_EVENTS: (keyof ApiEvents)[] = [
  'workspace:status',
  'workspace:changed',
  'workspace:files',
  'runner:case',
  'update:status',
  'app:close-requested'
]

/** Method names per domain, used by the preload script to build the bridge. */
export const API_METHODS: { [D in keyof Api]: (keyof Api[D])[] } = {
  workspace: ['state', 'clone', 'open', 'create', 'rename', 'remove', 'activate', 'setRemote', 'status', 'sync', 'resolveConflicts'],
  collections: [
    'list',
    'get',
    'save',
    'remove',
    'getFolder',
    'saveFolder',
    'removeFolder',
    'getRequest',
    'saveRequest',
    'duplicateRequest',
    'removeRequest',
    'move',
    'variableNames'
  ],
  environments: ['list', 'get', 'save', 'remove'],
  http: ['send', 'cancel', 'runtimeVars', 'clearRuntimeVars', 'cookies', 'deleteCookie', 'clearCookies'],
  importer: ['collection', 'environment', 'curl'],
  exporter: ['openapi'],
  runner: ['run', 'cancel'],
  settings: ['get', 'set'],
  dialog: ['openDirectory', 'openFile', 'saveFile'],
  app: ['info', 'close'],
  update: ['status', 'install', 'openTerminal', 'restart']
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
