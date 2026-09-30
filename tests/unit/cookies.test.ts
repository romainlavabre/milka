import { rmSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Cookies } from '@core/cookies'
import { executeRequest, type ExecuteOptions } from '@core/engine'
import { convertScript } from '@core/import/imported'
import { WorkspaceStore } from '@core/layout/store'
import { ensureWorkspaceLayout } from '@core/layout/workspace'
import { newCollection, newRequest, type HttpRequest } from '@core/model'
import { startEchoServer, type EchoServer } from './echo-server'
import { tempRoot } from './helpers'

describe('Cookies', () => {
  it('sends a cookie to its domain and subdomains, never over http when Secure', () => {
    const jar = new Cookies()
    jar.receive('https://api.example.com/login', ['SESSION=abc; Domain=example.com; Path=/', 'TOKEN=t; Secure; Path=/'])
    expect(jar.header('https://www.example.com/')).toBe('SESSION=abc')
    expect(jar.getAll('https://api.example.com/users')).toEqual({ SESSION: 'abc', TOKEN: 't' })
    // TOKEN has no Domain attribute: api.example.com only, and https only.
    expect(jar.get('https://www.example.com/', 'TOKEN')).toBeUndefined()
    expect(jar.get('http://api.example.com/', 'TOKEN')).toBeUndefined()
    expect(jar.header('https://example.org/')).toBe('')
  })

  it('lists, expires and deletes cookies', () => {
    const jar = new Cookies()
    jar.set('https://api.example.com', 'A', '1')
    jar.set('https://api.example.com', 'B', '2', { path: '/admin', expires: 3600, httpOnly: true })
    jar.set('https://api.example.com', 'OLD', 'x', { expires: -10 })
    expect(jar.list()).toMatchObject([
      { name: 'A', value: '1', domain: 'api.example.com', path: '/', expires: null, hostOnly: true },
      { name: 'B', path: '/admin', httpOnly: true }
    ])
    expect(jar.get('https://api.example.com/users', 'B')).toBeUndefined()
    expect(jar.get('https://api.example.com/admin/users', 'B')).toBe('2')
    jar.delete('https://api.example.com', 'A')
    expect(jar.list().map((c) => c.name)).toEqual(['B'])
    jar.clear()
    expect(jar.list()).toEqual([])
  })
})

describe('Cookies in requests', () => {
  let server: EchoServer
  let root: string
  let store: WorkspaceStore

  beforeAll(async () => {
    server = await startEchoServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(() => {
    root = tempRoot('milka-cookies-')
    ensureWorkspaceLayout(root, 'Test')
    store = new WorkspaceStore(root)
    const { id } = store.writeCollection(null, newCollection('API'))
    store.writeCollection(id, {
      ...store.readCollection(id),
      vars: [{ name: 'baseUrl', value: server.url, enabled: true, description: '' }]
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const request = (patch: Partial<HttpRequest>): string =>
    store.writeRequest('api', '', null, newRequest(`Request ${Math.random()}`, { url: '{{baseUrl}}/echo', ...patch })).id

  const run = (path: string, cookies: Cookies, patch: Partial<ExecuteOptions> = {}) =>
    executeRequest({ store, collection: 'api', path, environment: { name: null, vars: {} }, runtime: {}, cookies, ...patch })

  const receivedCookie = (result: Awaited<ReturnType<typeof run>>): string | undefined =>
    (JSON.parse(result.response!.body) as { headers: Record<string, string> }).headers.cookie

  it('sends the cookies received back to the next requests, next to a Cookie header written by hand', async () => {
    const jar = new Cookies()
    await run(request({ url: '{{baseUrl}}/login' }), jar)
    const echo = await run(request({ headers: [{ name: 'Cookie', value: 'MINE=1', enabled: true, description: '' }] }), jar)
    expect(receivedCookie(echo)).toBe('MINE=1; SESSION=abc')
    // The request shown in the app is the one sent, cookies included.
    expect(echo.request?.headers).toContainEqual(['Cookie', 'MINE=1; SESSION=abc'])
    // Without a shared jar, a request starts without cookies.
    expect(receivedCookie(await run(request({}), new Cookies()))).toBeUndefined()
  })

  it('keeps the cookies set during a redirect for the next hop', async () => {
    const result = await run(request({ url: '{{baseUrl}}/login-redirect' }), new Cookies())
    expect(result.response?.redirects).toHaveLength(1)
    expect(receivedCookie(result)).toBe('HOP=1')
  })

  it('lets scripts read, set and delete cookies', async () => {
    const jar = new Cookies()
    await run(request({ url: '{{baseUrl}}/login' }), jar)
    const result = await run(
      request({
        scripts: {
          pre: 'milka.cookies.set("{{baseUrl}}", "LANG", "fr")\nmilka.cookies.delete("{{baseUrl}}", "SESSION")',
          post: 'milka.vars.set("lang", milka.cookies.get("{{baseUrl}}", "LANG"))'
        }
      }),
      jar,
      { runtime: {} }
    )
    expect(receivedCookie(result)).toBe('LANG=fr')
    expect(result.logs.filter((l) => l.level === 'error')).toEqual([])
    expect(jar.getAll(server.url)).toEqual({ LANG: 'fr' })
  })

  it('converts the Bruno cookie jar calls on import', () => {
    const converted = convertScript(
      'const jar = bru.cookies.jar();\nawait jar.deleteCookies(bru.getEnvVar("host"));\njar.setCookie(url, "A", "1");',
      'Bruno'
    )
    expect(converted).toContain('const jar = milka.cookies;')
    expect(converted).toContain('await jar.clear(milka.env.get("host"));')
    expect(converted).toContain('jar.set(url, "A", "1");')
  })
})
