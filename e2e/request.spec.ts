// Sending a request with two bodies against a local server.
import { expect, test } from '@playwright/test'
import { startEchoServer } from '../tests/unit/echo-server'
import { answerPrompt, createCollection, createRequest, createWorkspace, launch } from './helpers'

test('sends each body variant of a request', async () => {
  const server = await startEchoServer()
  const { page, close } = await launch()
  await createWorkspace(page, 'Acme')
  await createCollection(page, 'Users')
  await createRequest(page, 'Users', 'Create user')

  await page.getByLabel('Method').selectOption('POST')
  await page.getByLabel('URL', { exact: true }).fill(`${server.url}/users`)

  await page.getByRole('tab', { name: 'Body' }).click()
  await page.getByRole('button', { name: 'Add body' }).click()
  await answerPrompt(page, 'Valid')
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.type('{"name": "Ada"')
  await page.getByRole('button', { name: 'Duplicate body' }).click()
  await answerPrompt(page, 'Missing name')
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('{}')

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('400 Bad Request')).toBeVisible()

  await page.getByRole('button', { name: 'Select body' }).click()
  await page.getByRole('menuitemradio', { name: /Valid/ }).click()
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText('201 Created')).toBeVisible()

  await page.keyboard.press('Control+s')
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  if (process.env.MILKA_SCREENSHOTS) await page.screenshot({ path: `${process.env.MILKA_SCREENSHOTS}/request.png` })

  await close()
  await server.close()
})
