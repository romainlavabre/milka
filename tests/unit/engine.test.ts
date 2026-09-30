import { rmSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { executeRequest, succeeded, type ExecuteOptions } from '@core/engine'
import { WorkspaceStore } from '@core/layout/store'
import { ensureWorkspaceLayout } from '@core/layout/workspace'
import { newBody, newCollection, newFolder, newRequest, type HttpRequest } from '@core/model'
import { startEchoServer, type EchoServer } from './echo-server'
import { tempRoot } from './helpers'

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
  root = tempRoot('milka-engine-')
  ensureWorkspaceLayout(root, 'Test')
  store = new WorkspaceStore(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const kv = (name: string, value: string) => ({ name, value, enabled: true, description: '' })

function setup(request: HttpRequest, folder = ''): { path: string; options: (patch?: Partial<ExecuteOptions>) => ExecuteOptions } {
  const collection = store.readCollection(store.writeCollection(null, newCollection('API')).id)
  store.writeCollection('api', {
    ...collection,
    headers: [kv('X-Collection', 'c'), kv('X-Level', 'collection')],
    vars: [kv('baseUrl', server.url), kv('who', 'collection')],
    auth: { ...collection.auth, type: 'bearer', token: '{{token}}' }
  })
  if (folder) store.writeFolder('api', '', null, { ...newFolder(folder), headers: [kv('X-Level', 'folder')], vars: [kv('who', 'folder')] })
  const path = store.writeRequest('api', folder ? folder.toLowerCase() : '', null, request).id
  return {
    path,
    options: (patch = {}) => ({
      store,
      collection: 'api',
      path,
      environment: { name: 'dev', vars: { token: 'env-token', who: 'env' } },
      runtime: {},
      ...patch
    })
  }
}

describe('executeRequest', () => {
  it('merges variables, headers and inherited auth', async () => {
    const { options } = setup(
      newRequest('Echo', {
        url: '{{baseUrl}}/echo/:id',
        params: [
          { ...kv('id', '{{who}}'), type: 'path' },
          { ...kv('q', 'a b'), type: 'query' },
          { ...kv('off', 'x'), enabled: false, type: 'query' }
        ],
        headers: [kv('x-level', 'request')]
      }),
      'Users'
    )
    const result = await executeRequest(options())
    expect(result.error).toBeNull()
    const echo = JSON.parse(result.response!.body)
    // Folder variables win over the environment, which wins over the collection.
    expect(echo.path).toBe('/echo/folder?q=a%20b')
    expect(echo.headers).toMatchObject({ 'x-collection': 'c', 'x-level': 'request', authorization: 'Bearer env-token', 'user-agent': 'Milka' })
  })

  it('sends the active body or the one asked for', async () => {
    const request = newRequest('Create', {
      method: 'POST',
      url: '{{baseUrl}}/users',
      bodies: [newBody('Valid', 'json', '{ "name": "{{name}}" }'), newBody('Missing name', 'json', '{}')],
      activeBody: 'Valid',
      vars: { pre: [kv('name', 'Ada')], post: [kv('userId', 'res.body.id')] },
      assertions: [{ expr: 'res.status', op: 'eq', value: '201', enabled: true }]
    })
    const { options } = setup(request)
    const runtime = {}
    const valid = await executeRequest(options({ runtime }))
    expect(valid.response?.status).toBe(201)
    expect(valid.request?.headers).toContainEqual(['Content-Type', 'application/json'])
    expect(valid.tests).toEqual([{ name: 'res.status equals 201', passed: true, kind: 'assertion' }])
    expect(runtime).toEqual({ userId: '1' })
    expect(succeeded(valid)).toBe(true)

    const missing = await executeRequest(options({ bodyName: 'Missing name' }))
    expect(missing.response?.status).toBe(400)
    expect(missing.tests[0]).toMatchObject({ passed: false, error: 'Actual value: 400' })
    expect(succeeded(missing)).toBe(false)
  })

  it('runs TypeScript scripts, tests and logs', async () => {
    const { options } = setup(
      newRequest('Scripted', {
        method: 'POST',
        url: '{{baseUrl}}/echo',
        bodies: [newBody('Body', 'json', '{ "a": 1 }')],
        scripts: {
          pre: "const stamp: string = 'fixed'\nreq.headers['X-Stamp'] = stamp\n;(req.body as { a: number }).a = 2\nconsole.log('pre', milka.env.name)",
          post: "milka.vars.set('echoed', res.body.body)"
        },
        tests: "test('status', () => expect(res.status).toBe(200))\ntest('fails', () => expect(res.status).not.toBe(200))"
      })
    )
    const runtime: Record<string, string> = {}
    const result = await executeRequest(options({ runtime }))
    const echo = JSON.parse(result.response!.body)
    expect(echo.headers['x-stamp']).toBe('fixed')
    expect(JSON.parse(echo.body)).toEqual({ a: 2 })
    expect(JSON.parse(runtime.echoed)).toEqual({ a: 2 })
    expect(result.logs).toEqual([{ level: 'log', source: 'pre-request (request)', message: 'pre dev' }])
    expect(result.tests).toEqual([
      { name: 'status', passed: true, kind: 'test' },
      { name: 'fails', passed: false, error: 'Expected 200 not to be 200', kind: 'test' }
    ])
  })

  it('reports script errors with their line and skips on demand', async () => {
    const broken = setup(newRequest('Broken', { url: '{{baseUrl}}/echo', scripts: { pre: 'const a = 1\nundefinedFn()', post: '' } }))
    const result = await executeRequest(broken.options())
    expect(result.error).toBe('pre-request (request) (line 2): undefinedFn is not defined')
    expect(result.request).toBeNull()

    const skipped = await executeRequest(broken.options({ request: newRequest('Skip', { scripts: { pre: "milka.skip('not today')", post: '' } }) }))
    expect(skipped).toMatchObject({ skipped: 'not today', error: null, request: null })
  })

  it('stops endless loops', async () => {
    const { options } = setup(newRequest('Loop', { url: '{{baseUrl}}/echo', scripts: { pre: 'while (true) {}', post: '' } }))
    const result = await executeRequest(options())
    expect(result.error).toMatch(/timed out/)
  }, 10_000)

  it('follows redirects, times out and reports network errors', async () => {
    const { options } = setup(newRequest('Redirect', { url: '{{baseUrl}}/redirect' }))
    const redirected = await executeRequest(options())
    expect(redirected.response?.redirects).toHaveLength(1)
    expect(JSON.parse(redirected.response!.body).path).toBe('/echo?redirected=1')

    const slow = await executeRequest(options({ request: newRequest('Slow', { url: '{{baseUrl}}/slow', settings: { timeout: 200, followRedirects: true, maxRedirects: 5 } }) }))
    expect(slow.error).toBe('Request timed out after 200 ms')

    const refused = await executeRequest(options({ request: newRequest('Down', { url: 'http://127.0.0.1:1/x' }) }))
    expect(refused.error).toBe('Connection refused by 127.0.0.1:1')
  })

  it('encodes forms and resolves built-in variables', async () => {
    const body = { ...newBody('Form', 'form'), fields: [{ ...kv('a', '{{$timestamp}}'), type: 'text' as const }, { ...kv('b', 'x y'), type: 'text' as const }] }
    const { options } = setup(newRequest('Form', { method: 'POST', url: '{{baseUrl}}/echo', bodies: [body] }))
    const result = await executeRequest(options({ processEnv: { HOME_DIR: '/home/x' } }))
    const echo = JSON.parse(result.response!.body)
    expect(echo.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(echo.body).toMatch(/^a=\d+&b=x\+y$/)
  })
})
