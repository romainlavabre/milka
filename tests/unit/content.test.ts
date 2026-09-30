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
    await alice.content.saveRequest(slug, '', null, newRequest('Create user', { method: 'POST', bodies: [newBody('Valid'), newBody('Empty')] }))
    await alice.content.saveEnvironment(
      slug,
      null,
      { ...newEnvironment('Prod'), vars: [{ name: 'baseUrl', value: 'https://api.acme.io', enabled: true, description: '' }], secrets: ['token'] },
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
    const envRenamed = await alice.content.saveEnvironment(renamed, env, { ...alice.content.getEnvironment(renamed, env).environment, name: 'Local' }, { token: 't' })
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
})
