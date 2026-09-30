import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newBody, newCollection, newEnvironment, newFolder, newRequest } from '@core/model'
import { ContentService } from '../../src/main/workspace/content'
import { bareRemote, git, tempRoot, user } from './helpers'

let root: string
let remote: string

beforeEach(() => {
  root = tempRoot('milka-content-')
  remote = bareRemote(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function content(name: string) {
  const u = user(root, name)
  return { ...u, content: new ContentService(u.ws, u.secrets) }
}

describe('ContentService', () => {
  it('shares collections through git, never the secret values', async () => {
    const alice = content('alice')
    await alice.ws.clone('Team', remote)
    const slug = await alice.content.saveCollection(null, newCollection('Users API', '#ef4444'))
    await alice.content.saveRequest(
      slug,
      '',
      null,
      newRequest('Create user', { method: 'POST', bodies: [newBody('Valid'), newBody('Empty')] })
    )
    await alice.content.saveEnvironment(
      slug,
      null,
      {
        ...newEnvironment('Prod'),
        vars: [{ name: 'baseUrl', value: 'https://api.acme.io', enabled: true, description: '' }],
        secrets: ['token']
      },
      { token: 'sup3r-s3cret' }
    )
    await alice.ws.flush()

    const bob = content('bob')
    await bob.ws.clone('Team', remote)
    expect(bob.content.listCollections()).toMatchObject([{ slug: 'users-api', name: 'Users API', color: '#ef4444' }])
    expect(bob.content.getRequest(slug, 'create-user.yaml').bodies.map((b) => b.name)).toEqual(['Valid', 'Empty'])
    expect(bob.content.getEnvironment(slug, 'prod')).toMatchObject({ environment: { secrets: ['token'] }, secretValues: {} })
    expect(alice.content.getEnvironment(slug, 'prod').secretValues).toEqual({ token: 'sup3r-s3cret' })

    expect(git(remote, 'log', '--all', '-p')).not.toContain('sup3r-s3cret')
    expect(git(remote, 'log', '--format=%s', 'master').trim().split('\n')).toEqual([
      'Add environment "Prod"',
      'Add request "Create user"',
      'Add collection "Users API"',
      'Initialize workspace'
    ])
  })

  it('keeps the secrets of a renamed collection and environment', async () => {
    const alice = content('alice')
    await alice.ws.create('Local')
    const slug = await alice.content.saveCollection(null, newCollection('API'))
    const env = await alice.content.saveEnvironment(slug, null, { ...newEnvironment('Dev'), secrets: ['token'] }, { token: 't' })
    const renamed = await alice.content.saveCollection(slug, { ...alice.content.getCollection(slug), name: 'Billing' })
    expect(renamed).toBe('billing')
    const envRenamed = await alice.content.saveEnvironment(
      renamed,
      env,
      { ...alice.content.getEnvironment(renamed, env).environment, name: 'Local' },
      { token: 't' }
    )
    expect(alice.content.getEnvironment(renamed, envRenamed).secretValues).toEqual({ token: 't' })
    // A variable no longer secret loses its local value.
    await alice.content.saveEnvironment(renamed, envRenamed, { ...newEnvironment('Local'), secrets: [] }, { token: 't' })
    expect(alice.content.getEnvironment(renamed, envRenamed).secretValues).toEqual({})
  })

  it('duplicates, moves and removes requests with one commit each', async () => {
    const alice = content('alice')
    const repo = await alice.ws.create('Local')
    const slug = await alice.content.saveCollection(null, newCollection('API'))
    const folder = await alice.content.saveFolder(slug, '', null, newFolder('Users'))
    const path = await alice.content.saveRequest(slug, '', null, newRequest('Ping'))
    const copy = await alice.content.duplicateRequest(slug, path)
    expect(copy).toBe('ping-copy.yaml')
    await alice.content.move(slug, copy, folder, null)
    await alice.content.removeRequest(slug, path)
    await alice.ws.flush()
    expect(git(repo.path, 'log', '--format=%s').trim().split('\n').slice(0, 4)).toEqual([
      'Remove request "Ping"',
      'Move "Ping (copy)"',
      'Add request "Ping (copy)"',
      'Add request "Ping"'
    ])
    expect(alice.content.listCollections()[0].children).toMatchObject([{ kind: 'folder', children: [{ path: 'users/ping-copy.yaml' }] }])
  })

  it('lists the variables a folder sees with an environment, their value and where they come from', async () => {
    const alice = content('alice')
    await alice.ws.create('Local')
    const row = (name: string, enabled = true) => ({ name, value: 'x', enabled, description: '' })
    const slug = await alice.content.saveCollection(null, { ...newCollection('API'), vars: [row('baseUrl'), row('off', false)] })
    const users = await alice.content.saveFolder(slug, '', null, { ...newFolder('Users'), vars: [row('userId')] })
    const admins = await alice.content.saveFolder(slug, users, null, { ...newFolder('Admins'), vars: [row('adminId')] })
    await alice.content.saveFolder(slug, '', null, { ...newFolder('Orders'), vars: [row('orderId')] })
    const env = await alice.content.saveEnvironment(
      slug,
      null,
      { ...newEnvironment('Dev'), vars: [row('hydraUrl')], secrets: ['token', 'untyped'] },
      { token: 't' }
    )

    expect(alice.content.visibleVariables(slug, '', null)).toEqual([
      { name: 'baseUrl', value: 'x', source: { kind: 'collection' }, secret: false }
    ])
    const variables = alice.content.visibleVariables(slug, admins, env)
    expect(variables.map((v) => v.name)).toEqual(['adminId', 'baseUrl', 'hydraUrl', 'token', 'untyped', 'userId'])
    expect(variables).toContainEqual({ name: 'adminId', value: 'x', source: { kind: 'folder', path: admins }, secret: false })
    expect(variables).toContainEqual({ name: 'token', value: 't', source: { kind: 'environment', env }, secret: true })
    // A secret whose value was never typed here.
    expect(variables).toContainEqual({ name: 'untyped', value: null, source: { kind: 'environment', env }, secret: true })
  })

  it('sets a variable of the collection, a folder or an environment', async () => {
    const alice = content('alice')
    await alice.ws.create('Local')
    const slug = await alice.content.saveCollection(null, {
      ...newCollection('API'),
      vars: [{ name: 'baseUrl', value: 'old', enabled: false, description: 'kept' }]
    })
    const folder = await alice.content.saveFolder(slug, '', null, newFolder('Users'))
    const env = await alice.content.saveEnvironment(slug, null, { ...newEnvironment('Dev'), secrets: ['token', 'other'] }, { other: 'o' })

    await alice.content.setVariable(slug, { kind: 'collection' }, 'baseUrl', 'new')
    await alice.content.setVariable(slug, { kind: 'folder', path: folder }, 'userId', '42')
    await alice.content.setVariable(slug, { kind: 'environment', env }, 'token', 's3cret')
    await alice.content.setVariable(slug, { kind: 'environment', env }, 'host', 'localhost')

    expect(alice.content.getCollection(slug).vars).toEqual([{ name: 'baseUrl', value: 'new', enabled: true, description: 'kept' }])
    expect(alice.content.getFolder(slug, folder).vars).toEqual([{ name: 'userId', value: '42', enabled: true, description: '' }])
    const environment = alice.content.getEnvironment(slug, env)
    expect(environment.secretValues).toEqual({ token: 's3cret', other: 'o' })
    expect(environment.environment.vars).toEqual([{ name: 'host', value: 'localhost', enabled: true, description: '' }])
  })
})
