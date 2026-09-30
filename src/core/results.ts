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
  logs: LogEntry[]
  tests: TestResult[]
  durationMs: number
}

/** True when the request was sent (or skipped on purpose) and every assertion and test passed. */
export function succeeded(result: ExecutionResult): boolean {
  return !result.error && (result.skipped !== null || (result.response !== null && result.tests.every((t) => t.passed)))
}
