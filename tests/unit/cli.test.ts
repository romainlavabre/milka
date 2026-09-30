import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runCli, type CliIo } from '../../src/cli/index'
import { WorkspaceStore } from '@core/layout/store'
import { ensureWorkspaceLayout } from '@core/layout/workspace'
import { newBody, newCollection, newEnvironment, newFolder, newRequest } from '@core/model'
import { startEchoServer, type EchoServer } from './echo-server'
import { tempRoot } from './helpers'

let server: EchoServer
let root: string

beforeAll(async () => {
  server = await startEchoServer()
})

afterAll(async () => {
  await server.close()
})

const kv = (name: string, value: string) => ({ name, value, enabled: true, description: '' })

beforeEach(() => {
  root = tempRoot('milka-cli-')
  ensureWorkspaceLayout(root, 'CI')
  const store = new WorkspaceStore(root)
  store.writeCollection(null, newCollection('Users API'))
  store.writeEnvironment('users-api', null, { ...newEnvironment('CI'), vars: [kv('baseUrl', server.url)], secrets: ['token'] })
  store.writeFolder('users-api', '', null, newFolder('Users'))
  store.writeRequest(
    'users-api',
    'users',
    null,
    newRequest('Create user', {
      method: 'POST',
      url: '{{baseUrl}}/users',
      headers: [kv('X-Token', '{{token}}')],
      tags: ['smoke'],
      bodies: [newBody('Valid', 'json', '{"name":"Ada"}'), newBody('Missing name', 'json', '{}')],
      assertions: [{ expr: 'res.status', op: 'eq', value: '201', enabled: true }]
    })
  )
  store.writeRequest(
    'users-api',
    '',
    null,
    newRequest('Echo token', {
      url: '{{baseUrl}}/echo',
      headers: [kv('X-Token', '{{token}}')],
      tests: "test('token', () => expect(res.body.headers['x-token']).toBe('t0k'))"
    })
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function io(env: Record<string, string> = {}): CliIo & { out: string; err: string } {
  const result = {
    out: '',
    err: '',
    stdout: (text: string) => void (result.out += text),
    stderr: (text: string) => void (result.err += text),
    cwd: root,
    env,
    color: false,
    version: '1.2.3'
  }
  return result
}

describe('milka run', () => {
  it('passes with the selected bodies and a secret from the process environment', async () => {
    const output = io({ MILKA_SECRET_TOKEN: 't0k' })
    const code = await runCli(['run', 'collections/users-api', '--env', 'CI', '--reporter', 'junit=out/report.xml'], output)
    expect(output.err).toBe('')
    expect(code).toBe(0)
    // The selected body variant is named in the report.
    expect(output.out).toContain('✓ Create user [Valid] 201')
    expect(output.out).toContain('Requests: 2 passed · Tests: 2 passed')
    const junit = readFileSync(join(root, 'out/report.xml'), 'utf8')
    expect(junit).toContain('<testsuite name="Users API" tests="2" failures="0" errors="0"')
    expect(junit).toContain('classname="users/create-user.yaml" name="Create user [Valid]"')
  })

  it('fails when a body variant breaks an assertion, and writes a JSON report', async () => {
    const output = io()
    const code = await runCli(
      [
        'run',
        'collections/users-api/users',
        '--env',
        'ci',
        '--all-bodies',
        '--env-var',
        'token=x',
        '--reporter',
        'json=report.json',
        '--reporter',
        'junit=report.xml'
      ],
      output
    )
    expect(code).toBe(1)
    expect(output.out).toContain('✓ Create user [Valid]')
    expect(output.out).toContain('✗ Create user [Missing name] 400')
    expect(output.out).toContain('✗ res.status equals 201 — Actual value: 400')
    const json = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'))
    expect(json.collections[0]).toMatchObject({
      passed: 1,
      failed: 1,
      cases: [
        { bodyName: 'Valid', status: 201 },
        { bodyName: 'Missing name', status: 400 }
      ]
    })
    expect(readFileSync(join(root, 'report.xml'), 'utf8')).toContain('<failure message="1 of 1 tests failed" type="AssertionError">')
  })

  it('warns about secrets without value and filters by tags', async () => {
    const output = io()
    const code = await runCli(['run', '.', '--env', 'CI', '--tags', 'smoke'], output)
    expect(output.err).toContain('Secrets without value: token')
    expect(code).toBe(0)
    expect(output.out).not.toContain('Echo token')
  })

  it('reports usage errors with exit code 2', async () => {
    expect(await runCli(['run'], io())).toBe(2)
    expect(await runCli(['run', 'collections/users-api', '--reporter', 'html=x'], io())).toBe(2)
    expect(await runCli(['nope'], io())).toBe(2)
    const outside = io()
    outside.cwd = '/'
    expect(await runCli(['run', 'tmp'], outside)).toBe(2)
  })
})
