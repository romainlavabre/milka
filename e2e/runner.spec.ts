// Runner tab: every body of a request, tests reported per case. The collection
// is written on disk from outside the app, which picks it up live.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { WorkspaceStore } from '../src/core/layout/store'
import { newBody, newCollection, newRequest } from '../src/core/model'
import { startEchoServer } from '../tests/unit/echo-server'
import { createWorkspace, launch } from './helpers'

test('runs a collection with every body variant', async () => {
  const server = await startEchoServer()
  const { page, root, close } = await launch()
  await createWorkspace(page, 'Acme')

  const store = new WorkspaceStore(join(root, 'data/workspaces/acme'))
  store.writeCollection(null, newCollection('Users API'))
  store.writeRequest(
    'users-api',
    '',
    null,
    newRequest('Create user', {
      method: 'POST',
      url: `${server.url}/users`,
      bodies: [newBody('Valid', 'json', '{"name":"Ada"}'), newBody('Missing name', 'json', '{}')],
      assertions: [{ expr: 'res.status', op: 'eq', value: '201', enabled: true }]
    })
  )
  await expect(page.getByText('Users API', { exact: true })).toBeVisible()

  await page.getByText('Users API', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Run collection' }).click()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('1 failed', { exact: true })).toBeVisible()
  await expect(page.getByText('Create user [Valid]')).toBeVisible()
  await page.getByText('Create user [Missing name]').click()
  await expect(page.getByText('res.status equals 201')).toBeVisible()
  if (process.env.MILKA_SCREENSHOTS) await page.screenshot({ path: `${process.env.MILKA_SCREENSHOTS}/runner.png` })

  await close()
  await server.close()
})
