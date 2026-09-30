// Runs the requests of a collection, folder or single request in order,
// sharing runtime variables between them: what the Runner tab and
// `milka run` do.
import { Cookies } from './cookies'
import { executeRequest, type EnvironmentValues } from './engine'
import type { WorkspaceStore } from './layout/store'
import { succeeded, type RunCase, type RunSummary } from './results'
import type { VarMap } from './vars'

export interface RunOptions {
  store: WorkspaceStore
  collection: string
  /** Folder or request path inside the collection; empty for the whole collection. */
  path: string
  environment: EnvironmentValues
  processEnv?: Record<string, string | undefined>
  insecure?: boolean
  /** Cookie jar of the run; a new one, shared by its requests, when omitted. */
  cookies?: Cookies
  /** One case per body for requests with several bodies, instead of the selected body only. */
  allBodies?: boolean
  /** Stop at the first failure. */
  bail?: boolean
  /** Only requests with one of these tags. */
  tags?: string[]
  /** Never requests with one of these tags. */
  excludeTags?: string[]
  /** Pause between requests, in milliseconds. */
  delayMs?: number
  signal?: AbortSignal
  onCase?(runCase: RunCase, index: number, total: number): void
}

export type { RunCase, RunSummary } from './results'

interface Planned {
  path: string
  bodyName: string | null
}

/** Requests (and bodies) a run will execute, in order. */
export function planRun(options: Pick<RunOptions, 'store' | 'collection' | 'path' | 'allBodies' | 'tags' | 'excludeTags'>): Planned[] {
  const { store, collection, path } = options
  const paths = path.endsWith('.yaml') ? [path] : store.listRequests(collection, path)
  const planned: Planned[] = []
  for (const requestPath of paths) {
    const request = store.readRequest(collection, requestPath)
    if (options.tags?.length && !request.tags.some((tag) => options.tags!.includes(tag))) continue
    if (options.excludeTags?.length && request.tags.some((tag) => options.excludeTags!.includes(tag))) continue
    if (options.allBodies && request.bodies.length > 1)
      for (const body of request.bodies) planned.push({ path: requestPath, bodyName: body.name })
    else planned.push({ path: requestPath, bodyName: null })
  }
  return planned
}

export async function runCollection(options: RunOptions): Promise<RunSummary> {
  const started = Date.now()
  const runtime: VarMap = {}
  const cookies = options.cookies ?? new Cookies()
  const planned = planRun(options)
  const cases: RunCase[] = []
  for (const [index, item] of planned.entries()) {
    if (options.signal?.aborted) break
    if (index > 0 && options.delayMs) await new Promise((done) => setTimeout(done, options.delayMs))
    const result = await executeRequest({
      store: options.store,
      collection: options.collection,
      path: item.path,
      bodyName: item.bodyName,
      environment: options.environment,
      runtime,
      cookies,
      processEnv: options.processEnv,
      insecure: options.insecure,
      signal: options.signal
    })
    const runCase: RunCase = {
      path: item.path,
      name: result.name,
      bodyName: result.request?.bodyName ?? item.bodyName,
      passed: succeeded(result),
      result
    }
    cases.push(runCase)
    options.onCase?.(runCase, index, planned.length)
    if (options.bail && !runCase.passed) break
  }
  const tests = cases.flatMap((c) => c.result.tests)
  return {
    collection: options.collection,
    collectionName: options.store.readCollection(options.collection).name,
    environment: options.environment.name,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    cases,
    passed: cases.filter((c) => c.passed && !c.result.skipped).length,
    failed: cases.filter((c) => !c.passed).length,
    skipped: cases.filter((c) => c.result.skipped).length,
    testsPassed: tests.filter((t) => t.passed).length,
    testsFailed: tests.filter((t) => !t.passed).length
  }
}

export { caseLabel } from './results'
