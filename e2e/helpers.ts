// Launches the built app on a throwaway data folder.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

export interface Launched {
  app: ElectronApplication
  page: Page
  root: string
  close(): Promise<void>
}

export async function launch(): Promise<Launched> {
  const root = mkdtempSync(join(tmpdir(), 'milka-e2e-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MILKA_DATA_DIR: join(root, 'data') } })
  const page = await app.firstWindow()
  return {
    app,
    page,
    root,
    async close() {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}

export async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add workspace' }).click()
  await page.getByPlaceholder('Client A').fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText(`Workspace "${name}" added`)).toBeVisible()
}

/** Answers the prompt dialog opened by the previous action. */
export async function answerPrompt(page: Page, value: string): Promise<void> {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(value)
  await dialog.getByRole('textbox').press('Enter')
  await expect(dialog).toBeHidden()
}

export async function createCollection(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New collection' }).click()
  await answerPrompt(page, name)
}

export async function createRequest(page: Page, collection: string, name: string): Promise<void> {
  await page.getByText(collection, { exact: true }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New request' }).click()
  await answerPrompt(page, name)
}
