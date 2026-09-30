// Scripts with autocompletion, and tests reported after sending.
import { expect, test } from '@playwright/test'
import { startEchoServer } from '../tests/unit/echo-server'
import { createCollection, createRequest, createWorkspace, launch, pasteCode } from './helpers'

test('completes the script API and reports tests', async () => {
  const server = await startEchoServer()
  const { app, page, close } = await launch()
  await createWorkspace(page, 'Acme')
  await createCollection(page, 'Echo')
  await createRequest(page, 'Echo', 'Ping')
  await page.getByLabel('URL').fill(`${server.url}/echo`)

  await page.getByRole('tab', { name: 'Scripts' }).click()
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.type('milka.')
  const suggestions = page.locator('.suggest-widget')
  await expect(suggestions).toContainText('sendRequest')
  await expect(suggestions).toContainText('vars')
  if (process.env.MILKA_SCREENSHOTS) await page.screenshot({ path: `${process.env.MILKA_SCREENSHOTS}/scripts.png` })
  await page.keyboard.press('Escape')
  await pasteCode(app, page, "vars.set('seen', req.method)")

  await page.getByRole('tab', { name: 'Tests' }).click()
  await page.locator('.monaco-editor').first().click()
  await pasteCode(
    app,
    page,
    "test('is ok', () => expect(res.status).toBe(200))\ntest('has seen', () => expect(milka.vars.get('seen')).toBe('GET'))"
  )
  // The paste lands asynchronously: wait for it before sending.
  await expect(page.locator('.monaco-editor').first()).toContainText('has seen')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByText('2/2 passed')).toBeVisible()

  await close()
  await server.close()
})
