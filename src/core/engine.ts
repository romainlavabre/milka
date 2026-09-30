// Executes a request of a collection, the same way in the app, the CLI and
// the MCP server:
//
//   1. variables: runtime > request > folders (inner first) > environment > collection
//   2. headers and auth inherited from the collection and folders
//   3. pre-request scripts (collection, folders, request), which may change `req`
//   4. `{{variable}}` interpolation, auth, body encoding, send
//   5. post-response variables, scripts, assertions and tests
//   6. when a post-response script called milka.retry(), once more from step 3
import { readFileSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { runAssertions } from './assert'
import { Cookies, type CookieOptions } from './cookies'
import { FormData, send, type PreparedRequest, type RawResponse } from './http'
import type { WorkspaceStore } from './layout/store'
import {
  activeBody,
  DEFAULT_TIMEOUT_MS,
  type Auth,
  type Body,
  type Collection,
  type Folder,
  type HttpRequest,
  type KeyValue
} from './model'
import type { ExecutionResult, Header, LogEntry, TestResult } from './results'
import { evaluate, runScript, SkipSignal, type MilkaApi, type ScriptRequest, type ScriptResponse, type ScriptScope } from './script'

export { succeeded, type ExecutionResult } from './results'
import { enabledVars, Variables, type VarMap } from './vars'

export interface EnvironmentValues {
  name: string | null
  /** Shared variables and local secret values. */
  vars: VarMap
}

export interface ExecuteOptions {
  store: WorkspaceStore
  collection: string
  /** Request file inside the collection. */
  path: string
  /** Unsaved version of the request, sent instead of the file. */
  request?: HttpRequest
  /** Body to send instead of the active one. */
  bodyName?: string | null
  environment: EnvironmentValues
  /** Variables set by scripts, shared by the requests of a session or run. */
  runtime: VarMap
  /** Cookie jar shared by the requests of a session or run; a new one for this request alone when omitted. */
  cookies?: Cookies
  processEnv?: Record<string, string | undefined>
  insecure?: boolean
  signal?: AbortSignal
}

// ------------------------------------------------------------------ helpers

function headerMap(lists: KeyValue[][]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const list of lists) {
    for (const row of list) {
      if (!row.enabled || !row.name) continue
      const existing = Object.keys(out).find((name) => name.toLowerCase() === row.name.toLowerCase())
      if (existing) delete out[existing]
      out[row.name] = row.value
    }
  }
  return out
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((h) => h.toLowerCase() === name.toLowerCase())
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  for (const h of Object.keys(headers)) if (h.toLowerCase() === name.toLowerCase()) delete headers[h]
  headers[name] = value
}

function folderPaths(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

function resolveAuth(request: HttpRequest, folders: Folder[], collection: Collection): Auth {
  for (const auth of [request.auth, ...[...folders].reverse().map((f) => f.auth), collection.auth]) {
    if (auth.type !== 'inherit') return auth
  }
  return { ...collection.auth, type: 'none' }
}

const CONTENT_TYPES: Partial<Record<Body['type'], string>> = {
  json: 'application/json',
  graphql: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  form: 'application/x-www-form-urlencoded',
  binary: 'application/octet-stream'
}

function withQuery(url: string, params: KeyValue[]): string {
  const query = params.filter((p) => p.enabled && p.name).map((p) => (p.value === '' ? p.name : `${p.name}=${p.value}`))
  if (query.length === 0) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query.join('&')}`
}

function withPathParams(url: string, params: KeyValue[]): string {
  let result = url
  for (const param of params) {
    if (!param.enabled || !param.name) continue
    const escaped = param.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`/:${escaped}(?=[/?#]|$)`, 'g'), `/${param.value}`)
  }
  return result
}

/** Normalizes an interpolated URL: adds http:// when missing and encodes what must be. */
export function normalizeUrl(raw: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    return new URL(withScheme).toString()
  } catch {
    throw new Error(`Invalid URL: ${raw || '(empty)'}`)
  }
}

function isTextual(contentType: string): boolean {
  return /^text\/|json|xml|javascript|x-www-form-urlencoded|graphql|yaml|csv/i.test(contentType)
}

function decodeBody(buffer: Buffer, contentType: string): { body: string; encoding: 'utf8' | 'base64' } {
  if (isTextual(contentType)) return { body: buffer.toString('utf8'), encoding: 'utf8' }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    if (!text.includes('\u0000')) return { body: text, encoding: 'utf8' }
  } catch {
    // Binary content.
  }
  return { body: buffer.toString('base64'), encoding: 'base64' }
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toScriptResponse(raw: RawResponse, text: string): ScriptResponse {
  const headers: Record<string, string> = {}
  for (const [name, value] of raw.headers) {
    const key = name.toLowerCase()
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value
  }
  const contentType = headers['content-type'] ?? ''
  return {
    status: raw.status,
    statusText: raw.statusText,
    headers,
    body: /json/i.test(contentType) || /^\s*[[{]/.test(text) ? parseMaybeJson(text) : text,
    text,
    time: Math.round(raw.timings.total),
    size: raw.body.length,
    header: (name) => headers[name.toLowerCase()]
  }
}

function stringify(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)
}

// -------------------------------------------------------------------- body

/** The body as scripts see it: parsed JSON, a field map for forms, text otherwise. */
function scriptBody(body: Body | null): unknown {
  if (!body) return undefined
  switch (body.type) {
    case 'none':
      return undefined
    case 'json':
      return parseMaybeJson(body.content)
    case 'graphql':
      return { query: body.content, variables: parseMaybeJson(body.variables || '{}') }
    case 'form':
    case 'multipart':
      return Object.fromEntries(body.fields.filter((f) => f.enabled && f.name && f.type === 'text').map((f) => [f.name, f.value]))
    default:
      return body.content
  }
}

interface EncodedBody {
  body?: string | Buffer | FormData
  preview: string | null
}

function readFile(root: string, path: string): Buffer {
  if (!path) throw new Error('No file selected for the body')
  return readFileSync(isAbsolute(path) ? path : resolve(root, path))
}

function encodeBody(body: Body | null, value: unknown, vars: Variables, root: string): EncodedBody {
  if (!body || body.type === 'none') return { preview: null }
  const text = (v: unknown): string => vars.interpolate(stringify(v))
  switch (body.type) {
    case 'json': {
      const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      const encoded = vars.interpolate(raw ?? '')
      return { body: encoded, preview: encoded }
    }
    case 'graphql': {
      const { query, variables } = (value ?? {}) as { query?: unknown; variables?: unknown }
      const vText = vars.interpolate(typeof variables === 'string' ? variables : JSON.stringify(variables ?? {}))
      const encoded = JSON.stringify({ query: text(query), variables: parseMaybeJson(vText || '{}') })
      return { body: encoded, preview: encoded }
    }
    case 'form': {
      const fields = (value ?? {}) as Record<string, unknown>
      const params = new URLSearchParams()
      for (const [name, v] of Object.entries(fields)) params.append(vars.interpolate(name), text(v))
      return { body: params.toString(), preview: params.toString() }
    }
    case 'multipart': {
      const fields = (value ?? {}) as Record<string, unknown>
      const form = new FormData()
      const lines: string[] = []
      for (const [name, v] of Object.entries(fields)) {
        form.append(vars.interpolate(name), text(v))
        lines.push(`${vars.interpolate(name)}: ${text(v)}`)
      }
      for (const field of body.fields.filter((f) => f.enabled && f.name && f.type === 'file')) {
        const path = vars.interpolate(field.value)
        form.append(vars.interpolate(field.name), new Blob([new Uint8Array(readFile(root, path))]), basename(path))
        lines.push(`${vars.interpolate(field.name)}: <file ${path}>`)
      }
      return { body: form, preview: lines.join('\n') }
    }
    case 'binary': {
      const path = vars.interpolate(stringify(value))
      const content = readFile(root, path)
      return { body: content, preview: `<file ${path}, ${content.length} bytes>` }
    }
    default: {
      const encoded = text(value)
      return { body: encoded, preview: encoded }
    }
  }
}

// ------------------------------------------------------------------ execute

/** Nesting limit of milka.runRequest(). */
const MAX_RUN_DEPTH = 3

export async function executeRequest(options: ExecuteOptions): Promise<ExecutionResult> {
  return (await execute(options, 0)).result
}

/** `depth` counts the milka.runRequest() calls that led to this request. */
async function execute(options: ExecuteOptions, depth: number): Promise<{ result: ExecutionResult; res?: ScriptResponse }> {
  const started = performance.now()
  const { store, collection: slug, path } = options
  const collection = store.readCollection(slug)
  const folders = folderPaths(path).map((folder) => store.readFolder(slug, folder))
  const request = options.request ?? store.readRequest(slug, path)
  const logs: LogEntry[] = []
  const result: ExecutionResult = {
    name: request.name,
    path,
    request: null,
    response: null,
    error: null,
    skipped: null,
    logs,
    tests: [],
    durationMs: 0
  }

  // Variables: request variables can use the lower scopes.
  const processEnv = options.processEnv ?? {}
  const lower: VarMap[] = [
    ...[...folders].reverse().map((f) => enabledVars(f.vars)),
    options.environment.vars,
    enabledVars(collection.vars)
  ]
  const lowerVars = new Variables(lower, processEnv)
  const requestVars: VarMap = {}
  for (const row of request.vars.pre) if (row.enabled && row.name) requestVars[row.name] = lowerVars.interpolate(row.value)
  const vars = new Variables([options.runtime, requestVars, ...lower], processEnv)

  const body = options.bodyName ? (request.bodies.find((b) => b.name === options.bodyName) ?? null) : activeBody(request)
  // A new one for each send: a retry starts again from the request as saved.
  const scriptRequest = (): ScriptRequest => {
    const req: ScriptRequest = {
      name: request.name,
      method: request.method,
      url: withQuery(
        withPathParams(
          request.url,
          request.params.filter((p) => p.type === 'path')
        ),
        request.params.filter((p) => p.type === 'query')
      ),
      headers: headerMap([collection.headers, ...folders.map((f) => f.headers), request.headers]),
      body: scriptBody(body),
      bodyName: body?.name ?? null,
      setHeader: (name, value) => setHeader(req.headers, name, String(value)),
      removeHeader: (name) => {
        for (const h of Object.keys(req.headers)) if (h.toLowerCase() === name.toLowerCase()) delete req.headers[h]
      }
    }
    return req
  }

  let phase: 'pre' | 'post' | 'tests' = 'pre'
  let retryRequested = false
  let retried = false
  const cookies = options.cookies ?? new Cookies()
  // Scripts name the site of a cookie by any URL of it, {{variables}} allowed.
  const cookieUrl = (url: string): string => normalizeUrl(vars.interpolate(url))
  const milka: MilkaApi = {
    cookies: {
      get: (url, name) => cookies.get(cookieUrl(url), name),
      getAll: (url) => cookies.getAll(cookieUrl(url)),
      set: (url, name, value, cookieOptions?: CookieOptions) => cookies.set(cookieUrl(url), name, stringify(value), cookieOptions),
      delete: (url, name) => cookies.delete(cookieUrl(url), name),
      clear: (url) => cookies.clear(url === undefined ? undefined : cookieUrl(url))
    },
    vars: {
      get: (name) => vars.get(name),
      set: (name, value) => {
        options.runtime[name] = stringify(value)
      },
      has: (name) => vars.get(name) !== undefined,
      delete: (name) => {
        delete options.runtime[name]
      }
    },
    env: { name: options.environment.name, get: (name) => options.environment.vars[name] },
    sendRequest: async (spec) => {
      const specHeaders: Header[] = Object.entries(spec.headers ?? {}).map(([n, v]) => [vars.interpolate(n), vars.interpolate(String(v))])
      let specBody: string | undefined
      if (spec.body !== undefined) {
        specBody = typeof spec.body === 'string' ? vars.interpolate(spec.body) : JSON.stringify(spec.body)
        if (typeof spec.body !== 'string' && !specHeaders.some(([n]) => n.toLowerCase() === 'content-type'))
          specHeaders.push(['Content-Type', 'application/json'])
      }
      const raw = await send(
        {
          method: (spec.method ?? 'GET').toUpperCase(),
          url: normalizeUrl(vars.interpolate(spec.url)),
          headers: specHeaders,
          body: specBody,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          followRedirects: true,
          maxRedirects: 5
        },
        { insecure: options.insecure, signal: options.signal, cookies }
      )
      return toScriptResponse(raw, raw.body.toString('utf8'))
    },
    runRequest: async (requestPath, runOptions) => {
      if (depth >= MAX_RUN_DEPTH) throw new Error(`milka.runRequest(): more than ${MAX_RUN_DEPTH} nested requests (${requestPath})`)
      if (!store.listRequests(slug, '').includes(requestPath))
        throw new Error(`milka.runRequest(): no request ${requestPath} in the collection`)
      const source = `runRequest ${requestPath}`
      const run = await execute(
        {
          store,
          collection: slug,
          path: requestPath,
          bodyName: runOptions?.body ?? null,
          environment: options.environment,
          runtime: options.runtime,
          cookies,
          processEnv: options.processEnv,
          insecure: options.insecure,
          signal: options.signal
        },
        depth + 1
      )
      // Its logs show here; its tests are its own.
      for (const entry of run.result.logs) logs.push({ ...entry, source: `${source} › ${entry.source}` })
      if (run.result.error) throw new Error(`${source}: ${run.result.error}`)
      if (run.result.skipped !== null) throw new Error(`${source}: skipped (${run.result.skipped})`)
      return run.res!
    },
    retry: () => {
      if (phase !== 'post') throw new Error('milka.retry() is only available in post-response scripts')
      const ignored = (message: string): void => void logs.push({ level: 'warn', source: 'retry', message })
      if (depth > 0) ignored('milka.retry() ignored in a request run by milka.runRequest()')
      else if (retried) ignored('milka.retry() ignored: the request was already retried')
      else retryRequested = true
    },
    skip: (reason) => {
      throw new SkipSignal(reason ?? 'Skipped by the pre-request script')
    },
    uuid: () => crypto.randomUUID(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    base64: {
      encode: (text) => Buffer.from(text, 'utf8').toString('base64'),
      decode: (b64) => Buffer.from(b64, 'base64').toString('utf8')
    }
  }
  const levels: { label: string; scripts: { pre: string; post: string }; tests: string }[] = [
    { label: 'collection', scripts: collection.scripts, tests: collection.tests },
    ...folders.map((f) => ({ label: `folder ${f.name}`, scripts: f.scripts, tests: f.tests })),
    { label: 'request', scripts: request.scripts, tests: request.tests }
  ]
  let scope!: ScriptScope

  /** One send, from the pre-request scripts to the tests; fills `result`. */
  const pass = async (): Promise<void> => {
    const req = scriptRequest()
    const tests: TestResult[] = []
    scope = { req, milka }
    Object.assign(result, { request: null, response: null, error: null, skipped: null, tests })

    // Pre-request scripts.
    phase = 'pre'
    try {
      for (const level of levels) await runScript(level.scripts.pre, scope, { source: `pre-request (${level.label})`, logs })
    } catch (error) {
      if (error instanceof SkipSignal) {
        result.skipped = error.reason
        return
      }
      result.error = (error as Error).message
      logs.push({ level: 'error', source: 'pre-request', message: result.error })
      return
    }

    // Build and send.
    let prepared: PreparedRequest
    try {
      const finalHeaders: Record<string, string> = {}
      for (const [name, value] of Object.entries(req.headers)) finalHeaders[vars.interpolate(name)] = vars.interpolate(String(value))
      let url = normalizeUrl(vars.interpolate(req.url))
      const auth = resolveAuth(request, folders, collection)
      if (auth.type === 'basic' && !hasHeader(finalHeaders, 'authorization')) {
        const token = Buffer.from(`${vars.interpolate(auth.username)}:${vars.interpolate(auth.password)}`).toString('base64')
        finalHeaders.Authorization = `Basic ${token}`
      } else if (auth.type === 'bearer' && !hasHeader(finalHeaders, 'authorization')) {
        finalHeaders.Authorization = `Bearer ${vars.interpolate(auth.token)}`
      } else if (auth.type === 'apikey' && auth.key) {
        const key = vars.interpolate(auth.key)
        const value = vars.interpolate(auth.value)
        if (auth.in === 'query') {
          const parsed = new URL(url)
          parsed.searchParams.set(key, value)
          url = parsed.toString()
        } else if (!hasHeader(finalHeaders, key)) finalHeaders[key] = value
      }
      const encoded = encodeBody(body, req.body, vars, store.root)
      const contentType = body ? CONTENT_TYPES[body.type] : undefined
      if (encoded.body !== undefined && contentType && !hasHeader(finalHeaders, 'content-type')) finalHeaders['Content-Type'] = contentType
      if (!hasHeader(finalHeaders, 'user-agent')) finalHeaders['User-Agent'] = 'Milka'
      prepared = {
        method: (req.method || 'GET').toUpperCase(),
        url,
        headers: Object.entries(finalHeaders),
        body: encoded.body,
        timeoutMs: request.settings.timeout || DEFAULT_TIMEOUT_MS,
        followRedirects: request.settings.followRedirects,
        maxRedirects: request.settings.maxRedirects
      }
      result.request = { method: prepared.method, url, headers: prepared.headers, body: encoded.preview, bodyName: body?.name ?? null }
    } catch (error) {
      result.error = (error as Error).message
      return
    }

    let raw: RawResponse
    try {
      raw = await send(prepared, { insecure: options.insecure, signal: options.signal, cookies })
    } catch (error) {
      result.error = (error as Error).message
      return
    }
    // Shows the Cookie header the jar added.
    if (result.request) result.request = { ...result.request, headers: raw.requestHeaders }
    const contentType = raw.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? ''
    const decoded = decodeBody(raw.body, contentType)
    result.response = {
      status: raw.status,
      statusText: raw.statusText,
      headers: raw.headers,
      body: decoded.body,
      encoding: decoded.encoding,
      contentType,
      size: raw.body.length,
      url: raw.url,
      redirects: raw.redirects,
      timings: raw.timings
    }
    scope.res = toScriptResponse(raw, decoded.encoding === 'utf8' ? decoded.body : '')

    // Post-response variables, scripts, assertions and tests.
    phase = 'post'
    for (const row of request.vars.post) {
      if (!row.enabled || !row.name || !row.value.trim()) continue
      try {
        options.runtime[row.name] = stringify(evaluate(row.value, scope))
      } catch (error) {
        logs.push({ level: 'error', source: 'post-response vars', message: `${row.name}: ${(error as Error).message}` })
      }
    }
    try {
      for (const level of levels) await runScript(level.scripts.post, scope, { source: `post-response (${level.label})`, logs, tests })
    } catch (error) {
      result.error = (error as Error).message
      logs.push({ level: 'error', source: 'post-response', message: result.error })
    }
    // The second send is the one tested.
    if (retryRequested && !retried) return
    phase = 'tests'
    tests.unshift(...runAssertions(request.assertions, scope))
    for (const level of levels) {
      try {
        await runScript(level.tests, scope, { source: `tests (${level.label})`, logs, tests })
      } catch (error) {
        tests.push({ name: `tests (${level.label})`, passed: false, error: (error as Error).message, kind: 'test' })
      }
    }
  }

  await pass()
  if (retryRequested) {
    retried = true
    result.retried = true
    logs.push({ level: 'info', source: 'retry', message: `Retried after ${scope.res?.status ?? 'an error'}` })
    await pass()
  }
  return { result: { ...result, durationMs: Math.round(performance.now() - started) }, res: scope.res }
}
