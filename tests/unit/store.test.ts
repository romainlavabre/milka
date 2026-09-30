import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newBody, newCollection, newEnvironment, newFolder, newRequest } from '@core/model'
import { WorkspaceStore } from '@core/layout/store'
import { ensureWorkspaceLayout } from '@core/layout/workspace'
import { tempRoot } from './helpers'

let root: string
let store: WorkspaceStore

beforeEach(() => {
  root = tempRoot('milka-store-')
  ensureWorkspaceLayout(root, 'Test')
  store = new WorkspaceStore(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('WorkspaceStore', () => {
  it('round-trips a request with several bodies in a readable YAML file', () => {
    const { id: slug } = store.writeCollection(null, newCollection('Users API', '#10b981'))
    expect(slug).toBe('users-api')
    const request = newRequest('Create user', {
      method: 'POST',
      url: '{{baseUrl}}/users',
      headers: [{ name: 'Content-Type', value: 'application/json', enabled: true, description: '' }],
      bodies: [newBody('Valid user', 'json', '{\n  "name": "Ada"\n}'), newBody('Missing name', 'json', '{}')],
      activeBody: 'Missing name',
      scripts: { pre: "req.headers['x-ts'] = String(Date.now())", post: '' },
      assertions: [{ expr: 'res.status', op: 'eq', value: 201, enabled: true }]
    })
    const { id: path, paths } = store.writeRequest(slug, '', null, request)
    expect(path).toBe('create-user.yaml')
    expect(paths).toEqual(['collections/users-api/create-user.yaml'])

    const file = readFileSync(join(root, 'collections/users-api/create-user.yaml'), 'utf8')
    expect(file).toContain('content: |-\n      {\n        "name": "Ada"\n      }')
    expect(file).not.toContain('enabled')
    expect(file).not.toContain('settings')
    expect(store.readRequest(slug, path)).toEqual({ ...request, seq: 1 })
  })

  it('reads hand-written files leniently', () => {
    const { id: slug } = store.writeCollection(null, newCollection('API'))
    writeFileSync(
      join(root, 'collections/api/ping.yaml'),
      'name: Ping\nmethod: get\nurl: /ping\nheaders:\n  - name: X-Num\n    value: 42\n  - nonsense\n'
    )
    const request = store.readRequest(slug, 'ping.yaml')
    expect(request).toMatchObject({ name: 'Ping', method: 'GET', url: '/ping', bodies: [], auth: { type: 'inherit' } })
    expect(request.headers).toEqual([{ name: 'X-Num', value: '42', enabled: true, description: '' }])
  })

  it('builds the tree ordered by seq and renames files with their name', () => {
    const { id: slug } = store.writeCollection(null, newCollection('API'))
    const { id: users } = store.writeFolder(slug, '', null, newFolder('Users'))
    store.writeRequest(slug, users, null, newRequest('List users'))
    const { id: get } = store.writeRequest(slug, users, null, newRequest('Get user'))
    store.writeRequest(slug, '', null, newRequest('Health'))

    expect(store.readTree(slug)).toMatchObject([
      { kind: 'folder', path: 'users', name: 'Users', seq: 1, children: [{ name: 'List users' }, { name: 'Get user' }] },
      { kind: 'request', path: 'health.yaml', seq: 2 }
    ])

    const renamed = store.writeRequest(slug, users, get, { ...store.readRequest(slug, get), name: 'Fetch user' })
    expect(renamed).toMatchObject({ id: 'users/fetch-user.yaml', renamedFrom: 'users/get-user.yaml' })
    expect(existsSync(join(root, 'collections/api/users/get-user.yaml'))).toBe(false)
    // Saving under the same name keeps the file.
    expect(store.writeRequest(slug, users, renamed.id, store.readRequest(slug, renamed.id)).id).toBe('users/fetch-user.yaml')
    expect(store.listRequests(slug)).toEqual(['users/list-users.yaml', 'users/fetch-user.yaml', 'health.yaml'])
  })

  it('moves and reorders nodes', () => {
    const { id: slug } = store.writeCollection(null, newCollection('API'))
    const { id: users } = store.writeFolder(slug, '', null, newFolder('Users'))
    const { id: a } = store.writeRequest(slug, '', null, newRequest('A'))
    const { id: b } = store.writeRequest(slug, '', null, newRequest('B'))

    store.move(slug, b, '', users)
    expect(store.readTree(slug).map((n) => n.name)).toEqual(['B', 'Users', 'A'])
    const moved = store.move(slug, a, users, null)
    expect(moved.id).toBe('users/a.yaml')
    expect(store.readTree(slug, users).map((n) => n.name)).toEqual(['A'])
    expect(() => store.move(slug, users, users, null)).toThrow(/into itself/)
  })

  it('never uses reserved names and refuses paths escaping the collection', () => {
    const { id: slug } = store.writeCollection(null, newCollection('API'))
    expect(store.writeFolder(slug, '', null, newFolder('Environments')).id).toBe('environments-2')
    expect(store.writeRequest(slug, '', null, newRequest('Folder')).id).toBe('folder-2.yaml')
    expect(() => store.readRequest(slug, '../../milka.json')).toThrow(/Invalid path/)
    expect(() => store.readCollection('../x')).toThrow(/Invalid collection/)
  })

  it('renames collections and stores environments without secret values', () => {
    const { id: slug } = store.writeCollection(null, newCollection('API'))
    const env = store.writeEnvironment(slug, null, {
      ...newEnvironment('Dev'),
      vars: [{ name: 'baseUrl', value: 'http://localhost', enabled: true, description: '' }],
      secrets: ['token']
    })
    expect(env.id).toBe('dev')
    expect(readFileSync(join(root, 'collections/api/environments/dev.yaml'), 'utf8')).toBe(
      'name: Dev\nvars:\n  - name: baseUrl\n    value: http://localhost\nsecrets:\n  - token\n'
    )
    const renamed = store.writeCollection(slug, { ...store.readCollection(slug), name: 'Public API' })
    expect(renamed).toMatchObject({ id: 'public-api', renamedFrom: 'api' })
    expect(store.listEnvironments('public-api')).toEqual([{ slug: 'dev', name: 'Dev' }])
    expect(store.listCollections().map((c) => c.slug)).toEqual(['public-api'])
  })

  it('keeps the order of variables and secrets only when the user changed it', () => {
    const { id: slug } = store.writeCollection(null, newCollection('API'))
    const base = {
      ...newEnvironment('Dev'),
      vars: [
        { name: 'baseUrl', value: 'http://localhost', enabled: true, description: '' },
        { name: 'user', value: 'ada', enabled: true, description: '' }
      ],
      secrets: ['token']
    }
    store.writeEnvironment(slug, null, { ...base, order: ['baseUrl', 'user', 'token'] })
    expect(readFileSync(join(root, 'collections/api/environments/dev.yaml'), 'utf8')).not.toContain('order')
    // A name that no longer exists is dropped.
    store.writeEnvironment(slug, 'dev', { ...base, order: ['token', 'gone', 'baseUrl', 'user'] })
    expect(store.readEnvironment(slug, 'dev').order).toEqual(['token', 'baseUrl', 'user'])
  })
})
