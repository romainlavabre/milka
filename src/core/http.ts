// Sends one HTTP request with undici, following redirects by hand so every
// hop shows in the timeline.
import { STATUS_CODES } from 'node:http'
import { Agent, FormData, request as undiciRequest, type Dispatcher } from 'undici'

import type { Header, Redirect } from './results'

export interface PreparedRequest {
  method: string
  url: string
  headers: Header[]
  body?: string | Buffer | FormData
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
}

export interface RawResponse {
  status: number
  statusText: string
  headers: Header[]
  body: Buffer
  /** Final URL after redirects. */
  url: string
  redirects: Redirect[]
  /** Milliseconds until the response headers, and until the end of the body. */
  timings: { ttfb: number; total: number }
}

export interface SendOptions {
  /** Accept invalid TLS certificates (self-signed dev servers). */
  insecure?: boolean
  signal?: AbortSignal
}

const agents = new Map<boolean, Dispatcher>()

function agent(insecure: boolean): Dispatcher {
  let found = agents.get(insecure)
  if (!found) {
    found = new Agent({ connect: { rejectUnauthorized: !insecure } })
    agents.set(insecure, found)
  }
  return found
}

function toHeaders(raw: Record<string, string | string[] | undefined>): Header[] {
  const out: Header[] = []
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) out.push([name, v])
  }
  return out
}

export async function send(prepared: PreparedRequest, options: SendOptions = {}): Promise<RawResponse> {
  const started = performance.now()
  const redirects: Redirect[] = []
  let { method, url, body } = prepared
  let headers = prepared.headers
  const timeout = AbortSignal.timeout(prepared.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  for (;;) {
    let response: Dispatcher.ResponseData
    try {
      response = await undiciRequest(url, {
        method: method as Dispatcher.HttpMethod,
        headers: headers.flat(),
        body,
        signal,
        dispatcher: agent(!!options.insecure)
      })
    } catch (error) {
      if (timeout.aborted) throw new Error(`Request timed out after ${prepared.timeoutMs} ms`, { cause: error })
      if (options.signal?.aborted) throw new Error('Request cancelled', { cause: error })
      throw describeNetworkError(error, url)
    }
    const ttfb = performance.now() - started
    const location = response.headers.location
    if (prepared.followRedirects && location && response.statusCode >= 300 && response.statusCode < 400) {
      await response.body.dump()
      if (redirects.length >= prepared.maxRedirects) throw new Error(`Too many redirects (${prepared.maxRedirects})`)
      const next = new URL(String(location), url).toString()
      redirects.push({ status: response.statusCode, url, location: next })
      // 303, and 301/302 after a POST, switch to GET without a body, like browsers.
      if (response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && method === 'POST')) {
        method = 'GET'
        body = undefined
        headers = headers.filter(([name]) => !/^(content-type|content-length)$/i.test(name))
      }
      // Credentials never follow a redirect to another host.
      if (new URL(next).host !== new URL(url).host) headers = headers.filter(([name]) => !/^(authorization|cookie)$/i.test(name))
      url = next
      continue
    }
    const buffer = Buffer.from(await response.body.arrayBuffer())
    return {
      status: response.statusCode,
      statusText: STATUS_CODES[response.statusCode] ?? '',
      headers: toHeaders(response.headers),
      body: buffer,
      url,
      redirects,
      timings: { ttfb, total: performance.now() - started }
    }
  }
}

function describeNetworkError(error: unknown, url: string): Error {
  const cause = (error as { cause?: { code?: string } }).cause
  const code = (error as { code?: string }).code ?? cause?.code
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  })()
  switch (code) {
    case 'ENOTFOUND':
      return new Error(`Cannot resolve host ${host}`)
    case 'ECONNREFUSED':
      return new Error(`Connection refused by ${host}`)
    case 'ECONNRESET':
      return new Error(`Connection reset by ${host}`)
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return new Error(`Untrusted TLS certificate for ${host} (${code}): enable "Accept invalid certificates" to send anyway`)
    default:
      return error instanceof Error ? new Error(error.message || String(code)) : new Error(String(error))
  }
}

export { FormData }
