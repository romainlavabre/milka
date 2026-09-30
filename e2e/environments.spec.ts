// Environments with a secret variable: used when sending, never written to the workspace.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { startEchoServer } from '../tests/unit/echo-server'
import { answerPrompt, createCollection, createRequest, createWorkspace, launch } from './helpers'

test('sends requests with environment variables and local secrets', async () => {
  const server = await startEchoServer()
  const { page, root, close } = await launch()
  await createWorkspace(page, 'Acme')
  await createCollection(page, 'Echo')

  // Creating a collection opens its settings on the environments.
  await page.getByRole('button', { name: 'New environment' }).first().click()
  await answerPrompt(page, 'Local')
  await page.getByPlaceholder('baseUrl').fill('baseUrl')
  await page.getByPlaceholder('Value').first().fill(server.url)
  await page.getByPlaceholder('Add…').fill('token')
  await page.getByRole('button', { name: 'Shared: value committed' }).nth(1).click()
  await page.getByPlaceholder('Secret value (local)').fill('s3cr3t-value')
  await page.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(page.getByText('Environment "Local" saved')).toBeVisible()

  const file = readFileSync(join(root, 'data/workspaces/acme/collections/echo/environments/local.yaml'), 'utf8')
  expect(file).toContain('secrets:\n  - token')
  expect(file).not.toContain('s3cr3t-value')

  // Dragging the secret above the variable keeps that order, although they are stored apart.
  const rows = page.locator('tbody tr')
  await page
    .getByRole('button', { name: 'Drag to reorder' })
    .nth(1)
    .dragTo(rows.first(), { targetPosition: { x: 60, y: 3 } })
  await expect(rows.first().locator('input').nth(1)).toHaveValue('token')
  await page.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect
    .poll(() => readFileSync(join(root, 'data/workspaces/acme/collections/echo/environments/local.yaml'), 'utf8'))
    .toContain('order:\n  - token\n  - baseUrl')

  await createRequest(page, 'Echo', 'Whoami')
  await page.getByLabel('URL', { exact: true }).fill('{{baseUrl}}/echo')
  await page.getByRole('tab', { name: 'Headers' }).click()
  await page.getByPlaceholder('Header').fill('X-Other')
  await page.getByPlaceholder('Add…').fill('X-Token')
  await page.getByPlaceholder('Value').nth(1).fill('{{token}}')
  // Headers move the same way, from the grip of the row.
  const headers = page.locator('tbody tr:visible')
  await page
    .locator('[aria-label="Drag to reorder"]:visible')
    .nth(1)
    .dragTo(headers.first(), { targetPosition: { x: 60, y: 3 } })
  await expect(headers.first().locator('input').nth(1)).toHaveValue('X-Token')
  await expect(headers.nth(1).locator('input').nth(1)).toHaveValue('X-Other')
  await page.getByLabel('Environment').selectOption({ label: 'Local' })
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('200 OK')).toBeVisible()
  await expect(page.locator('.monaco-editor').last()).toContainText('s3cr3t-value')

  await close()
  await server.close()
})
