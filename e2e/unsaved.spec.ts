// Unsaved changes survive switching tabs, and are asked about before closing a tab or quitting.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createCollection, createRequest, createWorkspace, launch } from './helpers'

test('keeps unsaved changes across tabs and asks about them before closing', async () => {
  const { app, page, root, close } = await launch()
  await createWorkspace(page, 'Acme')
  await createCollection(page, 'Users')
  await createRequest(page, 'Users', 'List users')
  await page.getByLabel('URL', { exact: true }).fill('http://localhost/users')
  await createRequest(page, 'Users', 'Get user')
  // The new tab shows once the request is loaded.
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('')
  await page.getByLabel('URL', { exact: true }).fill('http://localhost/users/1')

  // Back to the first tab: its change was kept while another tab was shown.
  const listTab = page.locator('[title="Users / list-users.yaml"]')
  await listTab.click()
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('http://localhost/users')

  // Closing a modified tab asks first; Cancel keeps it open.
  await listTab.getByRole('button', { name: 'Close tab' }).click()
  const popup = page.getByRole('dialog', { name: 'Unsaved changes' })
  await expect(popup).toContainText('1 file has unsaved changes')
  await popup.getByRole('button', { name: 'Cancel' }).click()
  await expect(listTab).toBeVisible()

  // Quitting asks about both requests: save one, discard the other.
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect(popup).toContainText('2 files have unsaved changes')
  await popup.getByRole('button', { name: 'Choose…' }).click()
  const choose = page.getByRole('dialog', { name: 'Choose the changes to save' })
  await choose.getByRole('radiogroup', { name: 'Request Get user' }).getByRole('radio', { name: 'Discard' }).click()
  if (process.env.MILKA_SCREENSHOTS) await page.screenshot({ path: `${process.env.MILKA_SCREENSHOTS}/unsaved.png` })
  await choose.getByRole('button', { name: 'Apply and quit' }).click()
  await closed

  const collection = join(root, 'data/workspaces/acme/collections/users')
  expect(readFileSync(join(collection, 'list-users.yaml'), 'utf8')).toContain('url: http://localhost/users')
  expect(readFileSync(join(collection, 'get-user.yaml'), 'utf8')).not.toContain('localhost/users/1')
  await close()
})
