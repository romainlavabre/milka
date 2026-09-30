// Collections tree: create, color, folders and requests, all written as YAML in the workspace.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { answerPrompt, createCollection, createRequest, createWorkspace, launch } from './helpers'

test('creates a colored collection with a folder and a request', async () => {
  const { page, root, close } = await launch()
  await createWorkspace(page, 'Acme')
  await createCollection(page, 'Users API')
  const workspace = join(root, 'data/workspaces/acme/collections/users-api')
  await expect.poll(() => existsSync(join(workspace, 'collection.yaml'))).toBe(true)

  // Color from the context menu.
  await page.getByText('Users API', { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Color' }).click()
  await page.getByRole('menuitem', { name: 'Color #ef4444' }).click()
  await expect.poll(() => readFileSync(join(workspace, 'collection.yaml'), 'utf8')).toContain('color: "#ef4444"')

  await page.getByText('Users API', { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New folder' }).click()
  await answerPrompt(page, 'Admin')
  await createRequest(page, 'Users API', 'List users')
  await expect(page.getByText('List users').first()).toBeVisible()
  await expect.poll(() => existsSync(join(workspace, 'list-users.yaml'))).toBe(true)
  expect(existsSync(join(workspace, 'admin/folder.yaml'))).toBe(true)

  await close()
})
