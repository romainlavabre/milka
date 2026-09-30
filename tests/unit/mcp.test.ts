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
      'get_collection_tree',
      'get_request',
      'list_collections',
      'list_environments',
      'list_workspaces',
      'run_request',
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
})
