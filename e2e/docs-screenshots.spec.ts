// Screenshots of the documentation, in docs/images: `npm run docs:screenshots`.
// A demo workspace is written on disk, served by a local echo server, and each
// screen of the docs is captured from it. Skipped unless MILKA_SCREENSHOTS is set.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { WorkspaceStore } from '../src/core/layout/store'
import { newBody, newCollection, newEnvironment, newFolder, newRequest } from '../src/core/model'
import { startEchoServer } from '../tests/unit/echo-server'
import { answerPrompt, createWorkspace, launch } from './helpers'

const out = process.env.MILKA_SCREENSHOTS

test.skip(!out, 'Set MILKA_SCREENSHOTS to the folder of the screenshots')

function seed(store: WorkspaceStore, baseUrl: string): void {
  const users = newCollection('Users API', '#3b82f6')
  users.headers = [{ name: 'Accept', value: 'application/json', enabled: true, description: '' }]
  users.auth = { ...users.auth, type: 'bearer', token: '{{token}}' }
  users.vars = [{ name: 'apiVersion', value: 'v1', enabled: true, description: '' }]
  users.scripts.pre = "req.setHeader('X-Request-Id', milka.uuid())"
  users.docs = '# Users API\n\nCreate, read and delete the users of the demo service.'
  store.writeCollection(null, users)

  store.writeRequest(
    'users-api',
    '',
    null,
    newRequest('List users', {
      seq: 1,
      url: '{{baseUrl}}/echo/users',
      params: [{ name: 'page', value: '1', enabled: true, description: '', type: 'query' }]
    })
  )
  store.writeRequest(
    'users-api',
    '',
    null,
    newRequest('Get user', {
      seq: 2,
      url: '{{baseUrl}}/echo/users/:id',
      params: [{ name: 'id', value: '{{userId}}', enabled: true, description: '', type: 'path' }]
    })
  )
  const create = newRequest('Create user', {
    seq: 3,
    method: 'POST',
    url: '{{baseUrl}}/users',
    bodies: [
      newBody('Valid user', 'json', '{\n  "name": "{{name}}",\n  "email": "ada@example.com",\n  "age": {{age}}\n}'),
      newBody('Missing name', 'json', '{\n  "email": "ada@example.com"\n}'),
      newBody('Empty', 'json', '{}')
    ],
    activeBody: 'Valid user',
    assertions: [
      { expr: 'res.status', op: 'eq', value: '201', enabled: true },
      { expr: 'res.body.id', op: 'exists', value: '', enabled: true }
    ],
    tests:
      "test('returns the new user', () => {\n  expect(res.body).toHaveProperty('id')\n  expect(res.body.name).toBe('Ada Lovelace')\n})\n\ntest('answers fast', () => expect(res.time).toBeLessThan(1000))"
  })
  create.vars = {
    pre: [
      { name: 'name', value: 'Ada Lovelace', enabled: true, description: '' },
      { name: 'age', value: '36', enabled: true, description: '' }
    ],
    post: [{ name: 'userId', value: 'res.body.id', enabled: true, description: '' }]
  }
  store.writeRequest('users-api', '', null, create)
  store.writeRequest('users-api', '', null, newRequest('Login', { seq: 4, method: 'POST', url: '{{baseUrl}}/login' }))

  const admin = newFolder('Admin')
  admin.seq = 5
  admin.headers = [{ name: 'X-Admin', value: 'true', enabled: true, description: '' }]
  store.writeFolder('users-api', '', null, admin)
  store.writeRequest('users-api', 'admin', null, newRequest('Delete user', { method: 'DELETE', url: '{{baseUrl}}/echo/users/{{userId}}' }))

  const local = newEnvironment('Local')
  local.vars = [{ name: 'baseUrl', value: baseUrl, enabled: true, description: '' }]
  local.secrets = ['token']
  store.writeEnvironment('users-api', null, local)
  const staging = newEnvironment('Staging')
  staging.vars = [{ name: 'baseUrl', value: 'https://staging.example.com', enabled: true, description: '' }]
  staging.secrets = ['token']
  store.writeEnvironment('users-api', null, staging)

  store.writeCollection(null, newCollection('Billing', '#f97316'))
  store.writeRequest('billing', '', null, newRequest('List invoices', { url: 'https://billing.example.com/invoices' }))
}

async function shot(page: Page, name: string): Promise<void> {
  // Lets transitions and Monaco settle.
  await page.waitForTimeout(400)
  // The notifications of the setup would hide part of the screen.
  await page.screenshot({ path: join(out!, `${name}.png`), style: '.fixed.bottom-9.right-3 { visibility: hidden }' })
}

test('captures the screens of the documentation', async () => {
  test.setTimeout(240_000)
  mkdirSync(out!, { recursive: true })
  const server = await startEchoServer()
  const { app, page, root, close } = await launch()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
  await createWorkspace(page, 'Demo')
  const workspace = join(root, 'data/workspaces/demo')
  seed(new WorkspaceStore(workspace), server.url)
  await expect(page.getByText('Users API', { exact: true })).toBeVisible()
  // A collection or request of the sidebar, not its mention in the pinned requests.
  const item = (name: string) => page.getByText(name, { exact: true }).and(page.locator('.flex-1')).first()

  // Sidebar: open the collection and its folder, pin a request.
  await item('Users API').click()
  await item('Admin').click()
  await page.getByText('List users', { exact: true }).hover()
  await page.getByRole('button', { name: 'Pin List users' }).click()

  // Environments, with the local value of the secret.
  await item('Users API').click({ button: 'right' })
  await shot(page, 'sidebar-menu')
  await page.getByRole('menuitem', { name: 'Settings & environments' }).click()
  await page.getByRole('button', { name: 'Local', exact: true }).click()
  await page.getByPlaceholder('Secret value (local)').fill('demo-token-123')
  await shot(page, 'environments')
  await page.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(page.getByText('Environment "Local" saved')).toBeVisible()
  await page.getByRole('tab', { name: 'Auth' }).click()
  await shot(page, 'collection-settings')

  // A request with several bodies, sent to the echo server.
  await item('Create user').click()
  await page.getByRole('button', { name: 'Environment' }).click()
  await page.getByRole('menuitem', { name: 'Local' }).click()
  await page.getByRole('tab', { name: /^Bod/ }).click()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText('201 Created')).toBeVisible()
  await shot(page, 'overview')

  await page.getByRole('button', { name: 'Select body' }).click()
  await shot(page, 'multiple-bodies')
  await page.keyboard.press('Escape')

  await page.getByRole('tab', { name: /^Tests \d/ }).click()
  await shot(page, 'tests')
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await shot(page, 'timeline')

  await page.getByRole('tab', { name: 'Vars' }).click()
  await shot(page, 'request-vars')
  await page.getByRole('tab', { name: 'Assert' }).click()
  await shot(page, 'assertions')

  // Hovering a variable of the URL shows its value and where it comes from.
  const variable = page.getByLabel('URL', { exact: true }).locator('xpath=..').locator('[data-variable="baseUrl"]').first()
  const box = await variable.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(page.getByRole('dialog', { name: 'Variable baseUrl' })).toBeVisible()
  await shot(page, 'variables-hover')
  await page.mouse.move(5, 880)

  // Script autocompletion.
  await page.getByRole('tab', { name: 'Scripts' }).click()
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.type('milka.')
  await expect(page.locator('.suggest-widget')).toContainText('runRequest')
  await shot(page, 'scripts')
  await page.keyboard.press('Escape')

  // The script left the request modified: closing it asks first.
  await page.keyboard.press('Control+w')
  const unsaved = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(unsaved).toBeVisible()
  await shot(page, 'unsaved')
  await unsaved.getByRole('button', { name: "Don't save" }).click()

  // Cookies set by a response.
  await item('Login').click()
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('{{baseUrl}}/login')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('200 OK')).toBeVisible()
  await page.getByRole('button', { name: 'Cookies' }).first().click()
  await expect(page.getByText('SESSION', { exact: true })).toBeVisible()
  await shot(page, 'cookies')
  await page.keyboard.press('Escape')

  // Runner, every body of every request.
  await item('Users API').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Run collection' }).click()
  await page.getByLabel('Every body').check()
  await expect(page.getByText('--all-bodies')).toBeVisible()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText(/^(\d+ failed|All passed)$/)).toBeVisible()
  await page.getByText('Create user [Missing name]').click()
  await shot(page, 'runner')

  // Import dialog.
  await page.getByRole('button', { name: 'Import (Bruno, Postman, OpenAPI, cURL)' }).click()
  await page.getByRole('button', { name: 'cURL', exact: true }).click()
  await page.getByPlaceholder(/curl 'https/).fill("curl 'https://api.example.com/users?page=2' -H 'Accept: application/json'")
  await shot(page, 'import')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Sync with a remote, then a conflict with a teammate.
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Teammate', '-c', 'user.email=teammate@example.com', ...args], { cwd, encoding: 'utf8' })
  const remote = join(root, 'remote.git')
  git(root, 'init', '--bare', '-b', 'master', remote)
  await page.getByRole('button', { name: /^Demo/ }).click()
  await page.getByRole('menuitem', { name: 'Demo' }).hover()
  await shot(page, 'workspaces')
  await page.getByRole('menuitem', { name: 'Set remote' }).click()
  await answerPrompt(page, remote)
  await page.getByRole('button', { name: 'Sync' }).click()
  await expect.poll(() => git(remote, 'log', '--oneline', '-1', 'master')).not.toBe('')

  const teammate = join(root, 'teammate')
  git(root, 'clone', remote, teammate)
  const listUsers = 'collections/users-api/list-users.yaml'
  writeFileSync(join(teammate, listUsers), 'name: List users\nseq: 1\nmethod: GET\nurl: "{{baseUrl}}/v2/users"\n')
  git(teammate, 'commit', '-am', 'Move users to v2')
  git(teammate, 'push')
  writeFileSync(join(workspace, listUsers), 'name: List users\nseq: 1\nmethod: GET\nurl: "{{baseUrl}}/users?all=1"\n')
  await page.getByRole('button', { name: 'Sync' }).click()
  await page.getByRole('button', { name: 'Resolve' }).click()
  await page.getByRole('button', { name: 'Keep mine' }).click()
  await shot(page, 'sync-conflict')
  await page.getByRole('button', { name: 'Later' }).click()

  await close()
  await server.close()
})
