// Creating a workspace and syncing it with a remote repository.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('creates a workspace and syncs it to a remote', async () => {
  const root = mkdtempSync(join(tmpdir(), 'milka-e2e-'))
  const remote = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '--initial-branch=master', remote])
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MILKA_DATA_DIR: join(root, 'data') } })
  const page = await app.firstWindow()

  await page.getByRole('button', { name: 'Add workspace' }).click()
  await page.getByPlaceholder('Client A').fill('Acme')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Workspace "Acme" added')).toBeVisible()

  await page.getByText('Local only').first().click()
  await page.getByRole('menuitem', { name: 'Acme' }).hover()
  await page.getByRole('menuitem', { name: 'Set remote' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill(remote)
  await page.getByRole('button', { name: 'Save' }).click()

  // The push runs in the background after the remote is set.
  const remoteLog = (): string => {
    try {
      return execFileSync('git', ['log', '--format=%s', 'master'], { cwd: remote, encoding: 'utf8', stdio: 'pipe' }).trim()
    } catch {
      return ''
    }
  }
  await expect.poll(remoteLog).toBe('Initialize workspace')
  await page.getByRole('button', { name: 'Sync' }).click()
  await expect(page.getByRole('button', { name: 'Sync' })).toBeEnabled()

  await app.close()
  rmSync(root, { recursive: true, force: true })
})
