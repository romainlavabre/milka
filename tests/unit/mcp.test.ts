import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from '@core/layout/store'
import { ensureWorkspaceLayout } from '@core/layout/workspace'
import { createMcpServer } from '../../src/mcp/server'
import { startEchoServer, type EchoServer } from './echo-server'
import { tempRoot } from './helpers'

let server: EchoServer
let root: string
let client: Client

beforeAll(async () => {
  server = await startEchoServer()
})

afterAll(async () => {
  await server.close()
})

beforeEach(async () => {
  root = tempRoot('milka-mcp-')
  ensureWorkspaceLayout(join(root, 'ws'), 'Team')
  const mcp = createMcpServer({ env: { MILKA_DATA_DIR: join(root, 'data') }, version: 'test', workspace: join(root, 'ws') })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1' })
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)])
})

afterEach(async () => {
  await client.close()
  rmSync(root, { recursive: true, force: true })
})

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
  return { text: result.content[0].text, isError: !!result.isError }
}

const json = async (name: string, args: Record<string, unknown> = {}): Promise<unknown> => JSON.parse((await call(name, args)).text)

describe('MCP server', () => {
  it('lists its tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_body',
      'create_collection',
      'create_environment',
      'create_folder',
      'create_request',
      'delete_item',
      'get_collection',
      'get_collection_tree',
      'get_folder',
      'get_request',
      'list_collections',
      'list_environments',
      'list_workspaces',
      'move_item',
      'run_request',
      'update_collection',
      'update_environment',
      'update_folder',
      'update_request'
    ])
  })

  it('creates a collection, a request with several bodies, and runs it', async () => {
    expect(await json('create_collection', { name: 'Users API', baseUrl: server.url, color: '#10b981' })).toEqual({
      collection: 'users-api'
    })
    expect(await json('create_folder', { collection: 'users-api', name: 'Users' })).toEqual({ path: 'users' })
    const created = (await json('create_request', {
      collection: 'users-api',
      parent: 'users',
      name: 'Create user',
      method: 'POST',
      url: '{{baseUrl}}/users',
      bodies: [{ name: 'Valid', type: 'json', content: '{"name": "Ada"}' }],
      assertions: [{ expr: 'res.status', op: 'eq', value: 201 }]
    })) as { path: string }
    expect(created.path).toBe('users/create-user.yaml')
    expect(await json('add_body', { collection: 'users-api', path: created.path, name: 'Missing name', content: '{}' })).toEqual({
      bodies: ['Valid', 'Missing name'],
      selected: 'Valid'
    })

    // Written as YAML in the workspace, like the app does.
    const store = new WorkspaceStore(join(root, 'ws'))
    expect(store.readRequest('users-api', created.path)).toMatchObject({
      method: 'POST',
      bodies: [{ name: 'Valid' }, { name: 'Missing name' }]
    })

    const tree = await call('get_collection_tree', { collection: 'users-api' })
    expect(tree.text).toContain('POST Create user  (users/create-user.yaml)')

    const valid = (await json('run_request', { collection: 'users-api', path: created.path })) as {
      response: { status: number }
      tests: { passed: boolean }[]
    }
    expect(valid.response.status).toBe(201)
    expect(valid.tests).toEqual([{ name: 'res.status equals 201', passed: true, kind: 'assertion' }])
    const missing = (await json('run_request', { collection: 'users-api', path: created.path, body: 'Missing name' })) as {
      response: { status: number }
    }
    expect(missing.response.status).toBe(400)

    const renamed = (await json('update_request', {
      collection: 'users-api',
      path: created.path,
      name: 'Register user',
      tags: ['smoke']
    })) as { path: string }
    expect(renamed.path).toBe('users/register-user.yaml')
    expect(store.readRequest('users-api', renamed.path)).toMatchObject({
      tags: ['smoke'],
      bodies: [{ name: 'Valid' }, { name: 'Missing name' }]
    })
  })

  it('never exposes secret values and reports errors as tool errors', async () => {
    await json('create_collection', { name: 'API' })
    await json('create_environment', {
      collection: 'api',
      name: 'Prod',
      variables: [{ name: 'baseUrl', value: 'https://x' }],
      secrets: ['token']
    })
    expect(await json('list_environments', { collection: 'api' })).toEqual([
      { slug: 'prod', name: 'Prod', variables: [{ name: 'baseUrl', value: 'https://x' }], secrets: ['token'] }
    ])
    const error = await call('get_request', { collection: 'api', path: '../../milka.json' })
    expect(error).toMatchObject({ isError: true, text: 'Invalid path: ../../milka.json' })
  })

  it('changes the scripts, variables, settings and selected body of a request', async () => {
    await json('create_collection', { name: 'API' })
    const { path } = (await json('create_request', {
      collection: 'api',
      name: 'Login',
      method: 'POST',
      bodies: [
        { name: 'Valid', content: '{}' },
        { name: 'Wrong password', content: '{}' }
      ],
      scripts: { pre: 'req.setHeader("X-A", "1")' }
    })) as { path: string }
    await json('update_request', {
      collection: 'api',
      path,
      activeBody: 'Wrong password',
      scripts: { post: 'milka.vars.set("token", res.body.token)' },
      variables: { post: [{ name: 'userId', value: 'res.body.id' }] },
      settings: { timeout: 5000 }
    })
    const store = new WorkspaceStore(join(root, 'ws'))
    expect(store.readRequest('api', path)).toMatchObject({
      activeBody: 'Wrong password',
      // The script left out is kept.
      scripts: { pre: 'req.setHeader("X-A", "1")', post: 'milka.vars.set("token", res.body.token)' },
      vars: { pre: [], post: [{ name: 'userId', value: 'res.body.id', enabled: true }] },
      settings: { timeout: 5000, followRedirects: true, maxRedirects: 5 }
    })
    expect(await call('update_request', { collection: 'api', path, activeBody: 'Nope' })).toMatchObject({
      isError: true,
      text: 'No body named "Nope". Bodies: Valid, Wrong password'
    })
  })

  it('reads and changes the settings of collections and folders', async () => {
    await json('create_collection', { name: 'API' })
    await json('create_folder', { collection: 'api', name: 'Admin' })
    expect(
      await json('update_collection', {
        collection: 'api',
        name: 'Public API',
        color: '#ef4444',
        headers: [{ name: 'X-Client', value: 'milka' }],
        auth: { type: 'bearer', token: '{{token}}' },
        variables: [{ name: 'baseUrl', value: 'https://api.acme.io' }]
      })
    ).toEqual({ collection: 'public-api' })
    expect(await json('get_collection', { collection: 'public-api' })).toMatchObject({
      name: 'Public API',
      color: '#ef4444',
      headers: [{ name: 'X-Client', value: 'milka' }],
      auth: { type: 'bearer', token: '{{token}}' },
      vars: [{ name: 'baseUrl', value: 'https://api.acme.io' }]
    })
    expect(
      await json('update_folder', {
        collection: 'public-api',
        path: 'admin',
        name: 'Back office',
        auth: { type: 'basic', username: '{{user}}', password: '{{password}}' },
        scripts: { pre: 'milka.vars.set("role", "admin")' },
        docs: 'Admin endpoints.'
      })
    ).toEqual({ path: 'back-office' })
    expect(await json('get_folder', { collection: 'public-api', path: 'back-office' })).toMatchObject({
      name: 'Back office',
      auth: { type: 'basic', username: '{{user}}' },
      scripts: { pre: 'milka.vars.set("role", "admin")', post: '' },
      docs: 'Admin endpoints.'
    })
  })

  it('changes environment variables and declares secrets without their values', async () => {
    await json('create_collection', { name: 'API' })
    await json('create_environment', { collection: 'api', name: 'Staging', variables: [{ name: 'baseUrl', value: 'https://old' }] })
    expect(
      await json('update_environment', {
        collection: 'api',
        environment: 'Staging',
        set: [
          { name: 'baseUrl', value: 'https://staging.acme.io' },
          { name: 'userId', value: '42' }
        ],
        secrets: ['token']
      })
    ).toEqual({
      environment: 'staging',
      variables: [
        { name: 'baseUrl', value: 'https://staging.acme.io' },
        { name: 'userId', value: '42' }
      ],
      secrets: ['token']
    })
    // A secret value is never written through the MCP server.
    expect(
      await call('update_environment', { collection: 'api', environment: 'staging', set: [{ name: 'token', value: 'abc' }] })
    ).toMatchObject({
      isError: true
    })
    // Renaming would lose the secret values saved on each machine: the app does it.
    expect((await call('update_environment', { collection: 'api', environment: 'staging', name: 'Preprod' })).text).toContain(
      'rename it in the Milka app'
    )
    expect((await call('update_collection', { collection: 'api', name: 'Other' })).text).toContain('rename it in the Milka app')
    expect(await json('update_environment', { collection: 'api', environment: 'staging', remove: ['userId', 'token'] })).toMatchObject({
      variables: [{ name: 'baseUrl' }],
      secrets: []
    })
    expect(await json('update_environment', { collection: 'api', environment: 'staging', name: 'Preprod' })).toMatchObject({
      environment: 'preprod'
    })
  })

  it('moves and deletes requests and folders', async () => {
    await json('create_collection', { name: 'API' })
    await json('create_folder', { collection: 'api', name: 'Users' })
    await json('create_request', { collection: 'api', name: 'Health' })
    const { path } = (await json('create_request', { collection: 'api', name: 'List users' })) as { path: string }
    expect(await json('move_item', { collection: 'api', path, parent: 'users' })).toEqual({ path: 'users/list-users.yaml' })
    expect(await json('move_item', { collection: 'api', path: 'health.yaml', before: 'users' })).toEqual({ path: 'health.yaml' })
    const store = new WorkspaceStore(join(root, 'ws'))
    expect(store.readTree('api').map((n) => n.path)).toEqual(['health.yaml', 'users'])
    expect(await json('delete_item', { collection: 'api', path: 'health.yaml' })).toEqual({ deleted: 'health.yaml' })
    expect(await json('delete_item', { collection: 'api', path: 'users' })).toEqual({ deleted: 'users' })
    expect(store.readTree('api')).toEqual([])
  })
})
