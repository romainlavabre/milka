// Results of request executions, shared with the renderer (types only).

export type Header = [name: string, value: string]

export interface Redirect {
  status: number
  url: string
  location: string
}

export interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  /** Where it was logged: `pre-request (collection)`, `tests (request)`… */
  source: string
  message: string
}

export interface TestResult {
  name: string
  passed: boolean
  error?: string
  kind: 'assertion' | 'test'
}

export interface SentRequest {
  method: string
  url: string
  headers: Header[]
  /** Text of the body; a summary for files and multipart bodies. */
  body: string | null
  bodyName: string | null
}

export interface ReceivedResponse {
  status: number
  statusText: string
  headers: Header[]
  body: string
  encoding: 'utf8' | 'base64'
  contentType: string
  size: number
  url: string
  redirects: Redirect[]
  timings: { ttfb: number; total: number }
}

export interface ExecutionResult {
  name: string
  path: string
  request: SentRequest | null
  response: ReceivedResponse | null
  /** Why the request could not be sent, or a script failure. */
  error: string | null
  /** Set when a pre-request script called milka.skip(). */
  skipped: string | null
  /** Set when a post-response script called milka.retry(): the result is the one of the second send. */
  retried?: boolean
  logs: LogEntry[]
  tests: TestResult[]
  durationMs: number
}

/** One request (and body) of a run. */
export interface RunCase {
  path: string
  name: string
  bodyName: string | null
  passed: boolean
  result: ExecutionResult
}

export interface RunSummary {
  collection: string
  collectionName: string
  environment: string | null
  startedAt: string
  durationMs: number
  cases: RunCase[]
  passed: number
  failed: number
  skipped: number
  testsPassed: number
  testsFailed: number
}

export function caseLabel(runCase: Pick<RunCase, 'name' | 'bodyName'>): string {
  return runCase.bodyName ? `${runCase.name} [${runCase.bodyName}]` : runCase.name
}

/** A cookie of the jar, as shown in the app. */
export interface CookieInfo {
  name: string
  value: string
  domain: string
  path: string
  /** ISO date, null for a session cookie. */
  expires: string | null
  secure: boolean
  httpOnly: boolean
  /** Sent to the domain only, not to its subdomains (no Domain attribute). */
  hostOnly: boolean
}

/** True when the request was sent (or skipped on purpose) and every assertion and test passed. */
export function succeeded(result: ExecutionResult): boolean {
  return !result.error && (result.skipped !== null || (result.response !== null && result.tests.every((t) => t.passed)))
}
