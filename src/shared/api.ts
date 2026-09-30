// IPC contract shared by the main process, the preload script and the renderer.
//
// Every method takes a single object argument (validated with zod in main) and
// is exposed on channel `${domain}:${method}`.

export interface AppInfo {
  version: string
  platform: string
}

export interface Api {
  app: {
    info(): Promise<AppInfo>
  }
}

/** Events pushed from the main process. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ApiEvents {}

/** Method names per domain, used by the preload script to build the bridge. */
export const API_METHODS: { [D in keyof Api]: (keyof Api[D])[] } = {
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
