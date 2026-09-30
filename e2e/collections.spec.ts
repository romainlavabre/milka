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
  // Opened with the keyboard: the pointer path to a submenu depends on the menu layout.
  await page.getByRole('menuitem', { name: 'Color' }).focus()
  await page.keyboard.press('ArrowRight')
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

test('searches the folders and requests of a collection', async () => {
  const { page, close } = await launch()
  await createWorkspace(page, 'Acme')
  await createCollection(page, 'Users API')
  await page.getByText('Users API', { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New folder' }).click()
  await answerPrompt(page, 'Admin')
  await page.getByText('Admin', { exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New request', exact: true }).click()
  await answerPrompt(page, 'Delete user')
  await createRequest(page, 'Users API', 'List users')
  const sidebar = page.locator('aside')
  await expect(sidebar.getByText('Delete user')).toBeVisible()

  await page.getByRole('button', { name: 'Search in Users API' }).click()
  const search = page.getByLabel('Search folders and requests of Users API')
  // A folder name shows the folder with its requests.
  await search.fill('admin')
  await expect(sidebar.getByText('1 request')).toBeVisible()
  await expect(sidebar.getByText('Delete user')).toBeVisible()
  await expect(sidebar.getByText('List users')).toBeHidden()
  // A request name shows the request, in its folder, opened.
  await search.fill('LIST')
  await expect(sidebar.getByText('List users')).toBeVisible()
  await expect(sidebar.getByText('Admin', { exact: true })).toBeHidden()
  await expect(sidebar.locator('mark', { hasText: 'List' })).toBeVisible()
  await search.fill('nothing')
  await expect(sidebar.getByText('No folder or request matches')).toBeVisible()
  // Escape closes the search and shows everything again.
  await search.press('Escape')
  await expect(search).toBeHidden()
  await expect(sidebar.getByText('List users')).toBeVisible()
  await expect(sidebar.getByText('Admin', { exact: true })).toBeVisible()

  await close()
})
