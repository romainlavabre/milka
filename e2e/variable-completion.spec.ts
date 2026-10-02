// Typing `{{` offers the variables the request resolves, in the fields and in the body.
import { expect, test } from '@playwright/test'
import { answerPrompt, createCollection, createRequest, createWorkspace, launch } from './helpers'

test('offers the variables after {{', async () => {
  const { page, close } = await launch()
  await createWorkspace(page, 'Acme')
  await createCollection(page, 'Echo')

  // Creating a collection opens its settings on the environments.
  await page.getByRole('button', { name: 'New environment' }).first().click()
  await answerPrompt(page, 'Local')
  await page.getByPlaceholder('baseUrl').fill('baseUrl')
  await page.getByPlaceholder('Value').first().fill('http://localhost:1234')
  await page.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(page.getByText('Environment "Local" saved')).toBeVisible()

  await createRequest(page, 'Echo', 'Whoami')
  const environment = page.getByRole('button', { name: 'Environment', exact: true })
  await environment.click()
  await page.getByRole('menuitem', { name: 'Local' }).click()
  await expect(environment).toContainText('Local')
  await expect(environment).toBeFocused()

  // In the URL: every name first, then those matching what is typed.
  const url = page.getByLabel('URL', { exact: true })
  await url.click()
  await url.pressSequentially('{{')
  const menu = page.getByRole('listbox', { name: 'Variables' })
  await expect(menu.getByRole('option', { name: /baseUrl/ })).toBeVisible()
  await expect(menu.getByRole('option', { name: /\$uuid/ })).toBeVisible()
  await expect(menu.getByRole('option', { name: /baseUrl/ })).toContainText('environment Local')
  await url.pressSequentially('ba')
  await expect(menu.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await url.pressSequentially('/echo')
  await expect(url).toHaveValue('{{baseUrl}}/echo')

  // Escape closes it and keeps what was typed.
  await url.pressSequentially('/{{')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(url).toHaveValue('{{baseUrl}}/echo/{{')
  await url.fill('{{baseUrl}}/echo')

  // In a header value, picked with the mouse.
  await page.getByRole('tab', { name: 'Headers' }).click()
  await page.getByPlaceholder('Header').fill('X-Request-Id')
  const value = page.locator('input[placeholder="Value"]:visible').first()
  await value.pressSequentially('{{$u')
  await menu.getByRole('option', { name: /\$uuid/ }).click()
  await expect(value).toHaveValue('{{$uuid}}')

  // In the body, through Monaco's suggestions.
  await page.getByRole('tab', { name: 'Body' }).click()
  await page.getByRole('button', { name: 'Add body' }).click()
  await answerPrompt(page, 'Default')
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.type('{"url": "{{bas')
  await expect(page.locator('.suggest-widget')).toContainText('baseUrl')
  await page.keyboard.press('Enter')
  await expect(page.locator('.monaco-editor').first()).toContainText('"{{baseUrl}}"')

  await close()
})
