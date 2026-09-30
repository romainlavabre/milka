// Runs pre-request / post-response scripts and tests.
//
// Scripts are TypeScript, stripped of their types by sucrase, and run in a
// separate V8 context exposing only the Milka API (`req`, `res`, `milka`,
// `test`, `expect`, `console`) and standard web globals. A context is not a
// security boundary: scripts come from the workspace and run with the user's
// rights, like the scripts of a package.json.
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'
import { transform } from 'sucrase'
import type { CookieOptions } from './cookies'
import { expect } from './expect'
import type { LogEntry, TestResult } from './results'

/** Synchronous time limit of a script, catching endless loops. */
const SYNC_TIMEOUT_MS = 5_000
/** Overall time limit, awaited promises included. */
const ASYNC_TIMEOUT_MS = 60_000

export type { LogEntry, TestResult } from './results'

/** The request as scripts see it. */
export interface ScriptRequest {
  name: string
  method: string
  url: string
  headers: Record<string, string>
  /** Parsed JSON for JSON bodies, text otherwise, undefined without body. */
  body: unknown
  /** Name of the body being sent (requests can have several). */
  bodyName: string | null
  setHeader(name: string, value: string): void
  removeHeader(name: string): void
}

/** The response as scripts see it. */
export interface ScriptResponse {
  status: number
  statusText: string
  /** Lower-cased names; repeated headers joined with ", ". */
  headers: Record<string, string>
  /** Parsed JSON when the body is JSON, text otherwise. */
  body: unknown
  text: string
  /** Milliseconds. */
  time: number
  /** Bytes. */
  size: number
  header(name: string): string | undefined
}

export interface MilkaApi {
  vars: {
    get(name: string): string | undefined
    set(name: string, value: unknown): void
    has(name: string): boolean
    delete(name: string): void
  }
  env: { name: string | null; get(name: string): string | undefined }
  cookies: {
    get(url: string, name: string): string | undefined
    getAll(url: string): Record<string, string>
    set(url: string, name: string, value: string, options?: CookieOptions): void
    delete(url: string, name: string): void
    clear(url?: string): void
  }
  sendRequest(options: { method?: string; url: string; headers?: Record<string, string>; body?: unknown }): Promise<ScriptResponse>
  skip(reason?: string): void
  uuid(): string
  sleep(ms: number): Promise<void>
  base64: { encode(text: string): string; decode(base64: string): string }
}

export interface ScriptScope {
  req: ScriptRequest
  res?: ScriptResponse
  milka: MilkaApi
}

/** Thrown by `milka.skip()`: stops the script and the request, without error. */
export class SkipSignal {
  constructor(readonly reason: string) {}
}

export function compile(code: string): string {
  return transform(code, { transforms: ['typescript'], disableESTransforms: true }).code
}

function format(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.stack ?? arg.message
      try {
        return JSON.stringify(arg, null, 2)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

/** Error message with the line in the user's script, not in the wrapper. */
function scriptError(error: unknown, source: string): Error {
  const err = error as Error
  const line = /<script>:(\d+)/.exec(err?.stack ?? '')?.[1]
  return new Error(`${source}${line ? ` (line ${line})` : ''}: ${err?.message ?? String(error)}`)
}

export interface RunOptions {
  source: string
  logs: LogEntry[]
  /** Collects `test()` calls; tests are not allowed where it is missing. */
  tests?: TestResult[]
}

function sandbox(scope: ScriptScope, options: RunOptions, pendingTests: Promise<void>[]): vm.Context {
  const log =
    (level: LogEntry['level']) =>
    (...args: unknown[]): void => {
      options.logs.push({ level, source: options.source, message: format(args) })
    }
  const test = (name: string, fn: () => unknown): void => {
    if (!options.tests) throw new Error('test() is only available in tests and post-response scripts')
    const record = (error?: unknown): void => {
      options.tests!.push(
        error === undefined
          ? { name, passed: true, kind: 'test' }
          : { name, passed: false, error: (error as Error)?.message ?? String(error), kind: 'test' }
      )
    }
    try {
      const result = fn()
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        pendingTests.push((result as Promise<unknown>).then(() => record(), record))
      } else record()
    } catch (error) {
      record(error)
    }
  }
  return vm.createContext({
    req: scope.req,
    res: scope.res,
    milka: scope.milka,
    test,
    expect,
    console: { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('log') },
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    structuredClone,
    crypto: { randomUUID }
  })
}

/** Runs a script; rejects with a readable message on error or timeout. */
export async function runScript(code: string, scope: ScriptScope, options: RunOptions): Promise<void> {
  if (!code.trim()) return
  let compiled: string
  try {
    compiled = compile(code)
  } catch (error) {
    throw new Error(`${options.source}: syntax error: ${(error as Error).message}`, { cause: error })
  }
  const pendingTests: Promise<void>[] = []
  const context = sandbox(scope, options, pendingTests)
  // Same first line as the user's code, so reported line numbers match.
  const wrapped = `(async () => {${compiled}\n})()`
  let timer: NodeJS.Timeout | undefined
  try {
    const running = vm.runInContext(wrapped, context, { timeout: SYNC_TIMEOUT_MS, filename: '<script>' }) as Promise<void>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ASYNC_TIMEOUT_MS / 1000} s`)), ASYNC_TIMEOUT_MS)
    })
    await Promise.race([running.then(() => Promise.all(pendingTests)), timeout])
  } catch (error) {
    if (error instanceof SkipSignal) throw error
    throw scriptError(error, options.source)
  } finally {
    clearTimeout(timer)
  }
}

/** Evaluates an expression such as `res.body.items[0].id` against the scope. */
export function evaluate(expression: string, scope: ScriptScope): unknown {
  const context = vm.createContext({ req: scope.req, res: scope.res, milka: scope.milka })
  const js = compile(expression).trim().replace(/;$/, '')
  return vm.runInContext(`(${js})`, context, { timeout: SYNC_TIMEOUT_MS, filename: '<expression>' })
}
