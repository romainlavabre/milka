// Sends requests of the active workspace from the app: environment with its
// local secrets, runtime variables kept for the session, cancellation.
import { executeRequest, type ExecutionResult } from '@core/engine'
import { environmentValues } from '@core/environment'
import type { HttpRequest } from '@core/model'
import type { VarMap } from '@core/vars'
import type { ContentService } from './workspace/content'
import type { WorkspaceManager } from './workspace/manager'
import type { SettingsStore } from './settings'

export class ExecutionService {
  /** Variables set by scripts, per workspace, until the app quits. */
  private readonly runtime = new Map<string, VarMap>()
  private readonly running = new Map<string, AbortController>()

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly content: ContentService,
    private readonly settings: SettingsStore
  ) {}

  runtimeVars(): VarMap {
    const repoId = this.workspace.active().id
    let vars = this.runtime.get(repoId)
    if (!vars) {
      vars = {}
      this.runtime.set(repoId, vars)
    }
    return vars
  }

  clearRuntimeVars(): void {
    this.runtime.delete(this.workspace.active().id)
  }

  async send(args: {
    requestId: string
    collection: string
    path: string
    request?: HttpRequest
    bodyName?: string | null
    env: string | null
  }): Promise<ExecutionResult> {
    const store = this.content.store()
    const controller = new AbortController()
    this.running.set(args.requestId, controller)
    try {
      const secrets = args.env ? this.content.secretValues(args.collection, args.env) : {}
      return await executeRequest({
        store,
        collection: args.collection,
        path: args.path,
        request: args.request,
        bodyName: args.bodyName,
        environment: environmentValues(store, args.collection, args.env, secrets),
        runtime: this.runtimeVars(),
        processEnv: process.env,
        insecure: this.settings.read().insecureTls,
        signal: controller.signal
      })
    } finally {
      this.running.delete(args.requestId)
    }
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.abort()
  }
}
