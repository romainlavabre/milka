import SwaggerParser from '@apidevtools/swagger-parser'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportOpenApi } from '@core/export/openapi'
import { importBruno } from '@core/import/bruno'
import { importCurl, shellWords } from '@core/import/curl'
import { writeImported } from '@core/import/imported'
import { importOpenApi } from '@core/import/openapi'
import { importPostman, importPostmanEnvironment } from '@core/import/postman'
import { WorkspaceStore } from '@core/layout/store'
import { ensureWorkspaceLayout } from '@core/layout/workspace'
import { newBody, newCollection, newEnvironment, newFolder, newRequest } from '@core/model'
import { tempRoot } from './helpers'

const fixtures = join(__dirname, '../fixtures')
let root: string
let store: WorkspaceStore

beforeEach(() => {
  root = tempRoot('milka-import-')
  ensureWorkspaceLayout(root, 'Test')
  store = new WorkspaceStore(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('Bruno import', () => {
  it('imports collection settings, folders, requests and environments', () => {
    const result = writeImported(store, importBruno(join(fixtures, 'bruno')))
    expect(result).toMatchObject({ slug: 'shop-api', requests: 2, warnings: [] })
    expect(store.readCollection('shop-api')).toMatchObject({
      name: 'Shop API',
      headers: [{ name: 'X-Client', value: 'milka-tests' }],
      auth: { type: 'bearer', token: '{{token}}' },
      vars: [{ name: 'apiVersion', value: 'v2' }],
      docs: 'The shop API.'
    })
    expect(store.readTree('shop-api').map((n) => n.name)).toEqual(['Orders', 'Health'])
    const order = store.readRequest('shop-api', 'orders/create-order.yaml')
    expect(order).toMatchObject({
      method: 'POST',
      url: '{{baseUrl}}/orders',
      params: [
        { name: 'dryRun', value: 'true', enabled: true, type: 'query' },
        { name: 'debug', value: '1', enabled: false, type: 'query' }
      ],
      auth: { type: 'inherit' },
      bodies: [{ name: 'Default', type: 'json', content: '{\n  "sku": "ABC-1",\n  "quantity": 2\n}' }],
      vars: { post: [{ name: 'orderId', value: 'res.body.id' }] },
      assertions: [
        { expr: 'res.status', op: 'eq', value: '201' },
        { expr: 'res.body.id', op: 'eq', value: 'isNumber' }
      ]
    })
    expect(order.scripts.pre).toContain('milka.vars.set("started", Date.now());')
    expect(order.tests).toContain('const data = res.body;')
    expect(store.readEnvironment('shop-api', 'local')).toEqual({
      name: 'Local',
      vars: [{ name: 'baseUrl', value: 'http://localhost:3000', enabled: true, description: '' }],
      secrets: ['token']
    })
  })

  it('imports the YAML format of Bruno 3 (OpenCollection)', () => {
    const result = writeImported(store, importBruno(join(fixtures, 'bruno-yaml/collections/shop')))
    // The name comes from the Bruno workspace, not from the generic one of opencollection.yml.
    expect(result).toMatchObject({
      slug: 'shop-api',
      requests: 2,
      warnings: ['orders/Live.yml: websocket requests are not supported yet, skipped']
    })
    const collection = store.readCollection('shop-api')
    expect(collection).toMatchObject({
      name: 'Shop API',
      headers: [{ name: 'X-Client', value: 'milka-tests' }],
      auth: { type: 'bearer', token: '{{token}}' },
      docs: 'The shop API.'
    })
    expect(collection.scripts.pre).toContain('req.setHeader("X-Request-Id"')
    expect(store.readTree('shop-api').map((n) => n.name)).toEqual(['Orders', 'Health'])
    expect(store.readFolder('shop-api', 'orders')).toMatchObject({
      headers: [{ name: 'Service', value: 'orders' }],
      docs: 'Orders of the shop.'
    })
    const order = store.readRequest('shop-api', 'orders/create-order.yaml')
    expect(order).toMatchObject({
      method: 'POST',
      url: '{{baseUrl}}/orders',
      params: [
        { name: 'dryRun', value: 'true', enabled: true, type: 'query' },
        { name: 'debug', value: '1', enabled: false, type: 'query' }
      ],
      auth: { type: 'inherit' },
      vars: { pre: [{ name: 'quantity', value: '2' }] },
      assertions: [
        { expr: 'res.status', op: 'eq', value: '201' },
        { expr: 'res.body.id', op: 'isType', value: 'number' }
      ],
      docs: 'Creates an order.',
      settings: { timeout: 10000, followRedirects: false, maxRedirects: 5 }
    })
    // The saved example becomes a second body.
    expect(order.bodies.map((b) => [b.name, b.type])).toEqual([
      ['Default', 'json'],
      ['Without quantity', 'json']
    ])
    expect(order.scripts.post).toContain('milka.vars.set("orderId", res.body.id);')
    expect(order.tests).toContain('expect(res.status).toBe(201);')
    expect(order.tests).toContain('expect(res.body.lines).toHaveLength(1);')
    expect(order.tests).toContain('expect(res.body.paid).toBe(false);')
    expect(order.tests).toContain('expect(res.body.status).not.toBe("cancelled");')
    expect(store.readRequest('shop-api', 'health.yaml').auth).toMatchObject({ type: 'apikey', key: 'X-Api-Key', in: 'header' })
    expect(store.readEnvironment('shop-api', 'local')).toEqual({
      name: 'Local',
      vars: [{ name: 'baseUrl', value: 'http://localhost:3000', enabled: true, description: '' }],
      secrets: ['token']
    })
  })

  it('explains that a Bruno workspace is imported collection by collection', () => {
    expect(() => importBruno(join(fixtures, 'bruno-yaml'))).toThrow(/is a Bruno workspace/)
  })
})

describe('Postman import', () => {
  it('turns saved examples into extra bodies', () => {
    const result = writeImported(store, importPostman(readFileSync(join(fixtures, 'postman.json'), 'utf8')))
    expect(result.requests).toBe(3)
    expect(store.readCollection('blog-api')).toMatchObject({ auth: { type: 'bearer', token: '{{token}}' }, vars: [{ name: 'baseUrl' }] })
    const create = store.readRequest('blog-api', 'posts/create-post.yaml')
    expect(create).toMatchObject({ url: '{{baseUrl}}/posts', params: [{ name: 'draft', value: 'true' }] })
    expect(create.bodies.map((b) => [b.name, b.content])).toEqual([
      ['Default', '{"title": "Hello"}'],
      ['Without title', '{}']
    ])
    expect(create.scripts.post).toContain("test('created', function () {\n  expect(res.status)")
    expect(create.scripts.post).toContain("milka.vars.set('postId', res.body.id)")
    expect(store.readRequest('blog-api', 'posts/get-post.yaml').params).toEqual([
      { name: 'id', value: '{{postId}}', enabled: true, description: '', type: 'path' }
    ])
    expect(store.readRequest('blog-api', 'login.yaml')).toMatchObject({
      auth: { type: 'none' },
      bodies: [{ type: 'form', fields: [{ name: 'user' }, { name: 'password' }] }]
    })
  })

  it('keeps only the names of secret environment variables', () => {
    const env = importPostmanEnvironment(
      JSON.stringify({
        name: 'Prod',
        values: [
          { key: 'baseUrl', value: 'https://x', enabled: true },
          { key: 'token', value: 'abc', type: 'secret' }
        ]
      })
    )
    expect(env).toEqual({
      name: 'Prod',
      vars: [{ name: 'baseUrl', value: 'https://x', enabled: true, description: '' }],
      secrets: ['token']
    })
  })
})

describe('OpenAPI import', () => {
  it('creates one request per operation, examples as bodies', () => {
    const imported = importOpenApi(readFileSync(join(fixtures, 'petstore.yaml'), 'utf8'))
    const result = writeImported(store, imported)
    expect(result).toMatchObject({ slug: 'petstore', requests: 5 })
    expect(store.readCollection('petstore')).toMatchObject({
      auth: { type: 'bearer', token: '{{token}}' },
      vars: [{ name: 'baseUrl', value: 'https://petstore.example.com/v1' }]
    })
    expect(store.listEnvironments('petstore').map((e) => e.name)).toEqual(['Local', 'Production'])
    expect(store.readEnvironment('petstore', 'local').secrets).toEqual(['token'])
    expect(store.readTree('petstore').map((n) => n.name)).toEqual(['pets', 'Health'])
    const create = store.readRequest('petstore', 'pets/create-a-pet.yaml')
    expect(create.bodies.map((b) => b.name)).toEqual(['A dog', 'Without name'])
    const update = store.readRequest('petstore', 'pets/update-a-pet.yaml')
    expect(update.url).toBe('{{baseUrl}}/pets/:petId')
    // The recursive owner reference stops at null.
    expect(JSON.parse(update.bodies[0].content)).toEqual({ name: 'string', tag: 'string', id: 0, owner: null })
    expect(store.readRequest('petstore', 'pets/list-pets.yaml').params).toMatchObject([{ name: 'limit', value: '20', enabled: false }])
    expect(store.readRequest('petstore', 'health.yaml').auth.type).toBe('none')
  })

  it('refuses Swagger 2', () => {
    expect(() => importOpenApi('swagger: "2.0"\ninfo: {}')).toThrow(/Swagger 2.0/)
  })
})

describe('cURL import', () => {
  it('splits shell words like a shell', () => {
    expect(shellWords(`curl -H 'A: b c' "x\\"y" $'l1\\nl2' \\\n --data a\\ b`)).toEqual([
      'curl',
      '-H',
      'A: b c',
      'x"y',
      'l1\nl2',
      '--data',
      'a b'
    ])
  })

  it('reads a JSON POST copied from a browser', () => {
    const request = importCurl(
      `curl 'https://api.example.com/v1/users?team=3' -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer abc' --data-raw '{"name":"Ada"}' --compressed`
    )
    expect(request).toMatchObject({
      name: 'POST /v1/users',
      method: 'POST',
      url: 'https://api.example.com/v1/users',
      params: [{ name: 'team', value: '3', type: 'query' }],
      headers: [{ name: 'Content-Type' }, { name: 'Authorization', value: 'Bearer abc' }],
      bodies: [{ type: 'json', content: '{\n  "name": "Ada"\n}' }]
    })
  })

  it('reads forms, files and basic auth', () => {
    expect(importCurl('curl -u ada:s3cret -d a=1 -d b=x%20y https://h/login')).toMatchObject({
      method: 'POST',
      auth: { type: 'basic', username: 'ada', password: 's3cret' },
      bodies: [
        {
          type: 'form',
          fields: [
            { name: 'a', value: '1' },
            { name: 'b', value: 'x y' }
          ]
        }
      ]
    })
    expect(importCurl('curl -F file=@photo.png -F title=Hi https://h/upload').bodies[0]).toMatchObject({
      type: 'multipart',
      fields: [
        { name: 'file', value: 'photo.png', type: 'file' },
        { name: 'title', value: 'Hi', type: 'text' }
      ]
    })
    expect(() => importCurl('wget x')).toThrow(/start with curl/)
  })
})

describe('OpenAPI export', () => {
  it('produces a valid OpenAPI 3.1 document with bodies as examples', async () => {
    const { id: slug } = store.writeCollection(null, {
      ...newCollection('Users API'),
      vars: [{ name: 'baseUrl', value: 'https://api.acme.io', enabled: true, description: '' }],
      auth: { type: 'bearer', token: '{{token}}', username: '', password: '', key: '', value: '', in: 'header' }
    })
    store.writeEnvironment(slug, null, {
      ...newEnvironment('Local'),
      vars: [{ name: 'baseUrl', value: 'http://localhost:3000', enabled: true, description: '' }]
    })
    const { id: users } = store.writeFolder(slug, '', null, newFolder('Users'))
    store.writeRequest(
      slug,
      users,
      null,
      newRequest('Create user', {
        method: 'POST',
        url: '{{baseUrl}}/users',
        bodies: [newBody('Valid', 'json', '{"name": "Ada", "age": 36}'), newBody('Missing name', 'json', '{"age": 1}')],
        assertions: [{ expr: 'res.status', op: 'eq', value: '201', enabled: true }]
      })
    )
    store.writeRequest(
      slug,
      users,
      null,
      newRequest('Get user', {
        url: '{{baseUrl}}/users/:id?fields=name',
        params: [{ name: 'id', value: '1', enabled: true, description: 'User id', type: 'path' }]
      })
    )

    const document = exportOpenApi(store, slug)
    await SwaggerParser.validate(structuredClone(document) as never)
    expect(document).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Users API' },
      servers: [
        { url: 'https://api.acme.io', description: 'Users API' },
        { url: 'http://localhost:3000', description: 'Local' }
      ],
      tags: [{ name: 'Users' }],
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } }
    })
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>
    expect(paths['/users'].post).toMatchObject({
      operationId: 'createUser',
      responses: { '201': {} },
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } },
            examples: { Valid: { value: { name: 'Ada', age: 36 } }, 'Missing name': { value: { age: 1 } } }
          }
        }
      }
    })
    expect(paths['/users/{id}'].get.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'User id' }
    ])
  })

  it('round-trips through the OpenAPI import', async () => {
    writeImported(store, importOpenApi(readFileSync(join(fixtures, 'petstore.yaml'), 'utf8')))
    const document = exportOpenApi(store, 'petstore')
    await SwaggerParser.validate(structuredClone(document) as never)
    expect(Object.keys(document.paths as object).sort()).toEqual(['/health', '/pets', '/pets/{petId}'])
  })
})
