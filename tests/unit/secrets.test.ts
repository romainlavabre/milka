import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecretStore, createCipher } from '../../src/main/secrets'
import { fakeCipher, tempRoot } from './helpers'

let root: string

beforeEach(() => {
  root = tempRoot('milka-secrets-')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const noKeyring = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }

describe('createCipher', () => {
  it('falls back to AES-GCM with a local key file without a keyring', () => {
    const cipher = createCipher(noKeyring, join(root, 'secrets.key'))
    const encrypted = cipher.encrypt('t0ken')
    expect(encrypted).toMatch(/^file:/)
    expect(encrypted).not.toContain('t0ken')
    expect(cipher.decrypt(encrypted)).toBe('t0ken')
    // A new instance reads the same key.
    expect(createCipher(noKeyring, join(root, 'secrets.key')).decrypt(encrypted)).toBe('t0ken')
  })
})

describe('SecretStore', () => {
  it('stores encrypted values per workspace and scope', () => {
    const store = new SecretStore(join(root, 'secrets.json'), createCipher(noKeyring, join(root, 'secrets.key')))
    store.set('repo', 'api/dev', { token: 'abc', empty: '' })
    expect(store.get('repo', 'api/dev')).toEqual({ token: 'abc' })
    expect(store.get('repo', 'api/prod')).toEqual({})
    expect(readFileSync(join(root, 'secrets.json'), 'utf8')).not.toContain('abc')
  })

  it('moves and forgets scopes', () => {
    const store = new SecretStore(join(root, 'secrets.json'), fakeCipher)
    store.set('repo', 'api/dev', { a: '1' })
    store.set('repo', 'api/prod', { b: '2' })
    store.set('repo', 'apiv2/dev', { c: '3' })
    store.move('repo', 'api', 'users')
    expect(store.get('repo', 'users/dev')).toEqual({ a: '1' })
    expect(store.get('repo', 'users/prod')).toEqual({ b: '2' })
    expect(store.get('repo', 'apiv2/dev')).toEqual({ c: '3' })
    store.forget('repo', 'users')
    expect(store.get('repo', 'users/dev')).toEqual({})
    expect(store.get('repo', 'apiv2/dev')).toEqual({ c: '3' })
  })

  it('never overwrites unreadable secrets with empty ones', () => {
    const store = new SecretStore(join(root, 'secrets.json'), fakeCipher)
    store.set('repo', 'api/dev', { a: '1' })
    const broken = new SecretStore(join(root, 'secrets.json'), {
      encrypt: fakeCipher.encrypt,
      decrypt: () => {
        throw new Error('key changed')
      }
    })
    expect(broken.read('repo', 'api/dev')).toEqual({ values: {}, unreadable: true })
    broken.set('repo', 'api/dev', {})
    expect(new SecretStore(join(root, 'secrets.json'), fakeCipher).get('repo', 'api/dev')).toEqual({ a: '1' })
  })
})
