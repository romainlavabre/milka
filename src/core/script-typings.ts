// TypeScript declarations of the script API, loaded in the script editors for
// autocompletion and type checking. Keep in sync with script.ts (a unit test
// compiles a script against them).

/** Declarations naming the known variables, for `milka.vars.get('…')` completion. */
export function variableTypings(names: string[]): string {
  const union = names.length ? names.map((n) => JSON.stringify(n)).join(' | ') + ' | ' : ''
  return `type MilkaVariableName = ${union}(string & {})\n`
}

export const SCRIPT_TYPINGS = `
/** The request about to be sent (pre-request) or that was sent (post-response). */
interface MilkaRequest {
  /** Name of the request in the collection. */
  readonly name: string
  /** HTTP method, e.g. "POST". Can be changed in pre-request scripts. */
  method: string
  /** URL with its query string, before {{variables}} are replaced. */
  url: string
  /** Headers inherited from the collection and folders plus the request's own. Add, change or delete keys. */
  headers: Record<string, string>
  /** Parsed JSON for JSON bodies, a field map for forms, text otherwise, undefined without body. Assign to replace it. */
  body: any
  /** Name of the body variant being sent (a request can have several). */
  readonly bodyName: string | null
  /** Sets a header, replacing any header with the same name whatever its case. */
  setHeader(name: string, value: string): void
  /** Removes a header, whatever its case. */
  removeHeader(name: string): void
}

/** The response received. Only available after the request was sent. */
interface MilkaResponse {
  /** Status code, e.g. 201. */
  readonly status: number
  readonly statusText: string
  /** Lower-cased header names; repeated headers are joined with ", ". */
  readonly headers: Record<string, string>
  /** Parsed JSON when the body is JSON, text otherwise. */
  readonly body: any
  /** Raw body text. */
  readonly text: string
  /** Total time in milliseconds. */
  readonly time: number
  /** Body size in bytes. */
  readonly size: number
  /** A header value, whatever the case of its name. */
  header(name: string): string | undefined
}

interface MilkaSendOptions {
  method?: string
  /** May contain {{variables}}. */
  url: string
  headers?: Record<string, string>
  /** Objects are sent as JSON. */
  body?: unknown
}

interface Milka {
  /** Variables: runtime values set by scripts first, then request, folder, environment and collection variables. */
  vars: {
    get(name: MilkaVariableName): string | undefined
    /** Keeps a value for the next requests (objects are stored as JSON). */
    set(name: MilkaVariableName, value: unknown): void
    has(name: MilkaVariableName): boolean
    /** Forgets a runtime value. */
    delete(name: MilkaVariableName): void
  }
  /** The selected environment. */
  env: {
    readonly name: string | null
    get(name: MilkaVariableName): string | undefined
  }
  /** Sends another request, e.g. to fetch a token. */
  sendRequest(options: MilkaSendOptions): Promise<MilkaResponse>
  /** Pre-request only: does not send this request (the run goes on). */
  skip(reason?: string): never
  /** A random UUID v4. */
  uuid(): string
  /** Waits, e.g. await milka.sleep(500). */
  sleep(ms: number): Promise<void>
  base64: {
    encode(text: string): string
    decode(base64: string): string
  }
}

interface MilkaMatchers {
  /** Negates the next matcher: expect(x).not.toBe(1). */
  readonly not: MilkaMatchers
  /** Strict equality (Object.is). */
  toBe(expected: unknown): void
  /** Deep equality of objects and arrays. */
  toEqual(expected: unknown): void
  toBeDefined(): void
  toBeUndefined(): void
  toBeNull(): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeGreaterThan(n: number): void
  toBeGreaterThanOrEqual(n: number): void
  toBeLessThan(n: number): void
  toBeLessThanOrEqual(n: number): void
  /** Substring of a string, or item of an array (deep equality). */
  toContain(item: unknown): void
  toMatch(pattern: RegExp | string): void
  toHaveLength(length: number): void
  /** Property at a dotted path, optionally with a value: toHaveProperty('user.id', 42). */
  toHaveProperty(path: string, value?: unknown): void
  toBeTypeOf(type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined'): void
  toBeOneOf(values: unknown[]): void
}

/** The request. */
declare const req: MilkaRequest
/** The response (post-response scripts and tests). */
declare const res: MilkaResponse
/** Variables, environment and helpers. */
declare const milka: Milka
/** Declares a test, shown in the Tests tab and reported by milka run. */
declare function test(name: string, fn: () => void | Promise<void>): void
declare function expect(value: unknown): MilkaMatchers

declare const console: {
  log(...values: unknown[]): void
  info(...values: unknown[]): void
  warn(...values: unknown[]): void
  error(...values: unknown[]): void
  debug(...values: unknown[]): void
}
declare function setTimeout(callback: () => void, ms?: number): unknown
declare function clearTimeout(handle: unknown): void
declare function atob(data: string): string
declare function btoa(data: string): string
declare function structuredClone<T>(value: T): T
declare const crypto: { randomUUID(): string }
declare class URLSearchParams {
  constructor(init?: string | Record<string, string>)
  get(name: string): string | null
  set(name: string, value: string): void
  append(name: string, value: string): void
  delete(name: string): void
  has(name: string): boolean
  toString(): string
}
declare class URL {
  constructor(url: string, base?: string)
  href: string
  origin: string
  protocol: string
  host: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
  readonly searchParams: URLSearchParams
  toString(): string
}
declare class TextEncoder {
  encode(input?: string): Uint8Array
}
declare class TextDecoder {
  decode(input?: Uint8Array): string
}
`
