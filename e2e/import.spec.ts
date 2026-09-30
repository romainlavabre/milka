// Importing a Bruno collection and a cURL command from the app.
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createWorkspace, launch } from './helpers'

test('imports a Bruno collection and a cURL command', async () => {
  const { page, close } = await launch()
  await createWorkspace(page, 'Acme')

  await page.getByRole('button', { name: /^Import/ }).click()
  await page.getByPlaceholder('/path/to/bruno-collection').fill(join(__dirname, '../tests/fixtures/bruno'))
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText('Imported 2 requests')).toBeVisible()
  await expect(page.getByText('Shop API', { exact: true }).first()).toBeVisible()

  await page.getByText('Shop API', { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New request from cURL' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill(`curl https://api.example.com/users -H 'Accept: application/json'`)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://api.example.com/users')
  await expect(page.getByText('GET /users').first()).toBeVisible()

  await close()
})
