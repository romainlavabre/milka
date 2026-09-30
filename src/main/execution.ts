// Sends requests of the active workspace from the app: environment with its
// local secrets, runtime variables kept for the session, cancellation.
import { executeRequest, type ExecutionResult } from '@core/engine'
import { environmentValues } from '@core/environment'
import type { HttpRequest } from '@core/model'
import type { RunCase, RunSummary } from '@core/results'
import { runCollection } from '@core/runner'
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

  /** Runs a collection, folder or request with its tests; each case is reported as it completes. */
  async run(
    args: { runId: string; collection: string; path: string; env: string | null; allBodies: boolean; bail: boolean; tags: string[] },
    onCase: (runCase: RunCase, index: number, total: number) => void
  ): Promise<RunSummary> {
    const store = this.content.store()
    const controller = new AbortController()
    this.running.set(args.runId, controller)
    try {
      const secrets = args.env ? this.content.secretValues(args.collection, args.env) : {}
      return await runCollection({
        store,
        collection: args.collection,
        path: args.path,
        environment: environmentValues(store, args.collection, args.env, secrets),
        processEnv: process.env,
        insecure: this.settings.read().insecureTls,
        allBodies: args.allBodies,
        bail: args.bail,
        tags: args.tags,
        signal: controller.signal,
        onCase
      })
    } finally {
      this.running.delete(args.runId)
    }
  }
}
