// Electron entry point: window, IPC registration and services.
import { join, resolve } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } from 'electron'
import type { ZodType } from 'zod'
import { API_METHODS, type Api, type ApiEvents } from '@shared/api'
import { COMMANDS, runCli } from '../cli/index'
import { createHandlers } from './ipc/handlers'
import { schemas } from './ipc/schemas'
import { ExecutionService } from './execution'
import { SecretStore, createCipher } from './secrets'
import { SettingsStore } from './settings'
import { JsonStore } from './jsonStore'
import { ContentService, secretScope } from './workspace/content'
import { WorkspaceManager } from './workspace/manager'
import { WorkspaceWatcher } from './workspace/watcher'
import type { WorkspaceState } from '@shared/types'

// Keeps the data folder name stable (~/.config/milka) whatever the product name.
app.setName('milka')
if (process.env.MILKA_DATA_DIR) app.setPath('userData', process.env.MILKA_DATA_DIR)

// Launched from a snap's terminal (JetBrains IDEs, VS Code…), SNAP_NAME is
// inherited: libsecret then believes it runs confined and stores the keyring
// key through the secret portal, where it cannot find it again at the next
// launch, so every saved secret becomes unreadable. Drop it unless the app
// really is that snap.
if (process.env.SNAP_NAME && !(process.env.SNAP && process.execPath.startsWith(process.env.SNAP + '/'))) {
  delete process.env.SNAP_NAME
}

let mainWindow: BrowserWindow | null = null

function send<E extends keyof ApiEvents>(event: E, payload: ApiEvents[E]): void {
  mainWindow?.webContents.send(event, payload)
}

function secretsEncrypted(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false
  // On Linux without a keyring, Electron falls back to a hard-coded key.
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Milka',
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // Links open in the browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isTrustedSender(frameUrl: string | undefined): boolean {
  if (!frameUrl) return false
  if (frameUrl.startsWith('file://')) return true
  const devUrl = process.env.ELECTRON_RENDERER_URL
  return !app.isPackaged && !!devUrl && frameUrl.startsWith(devUrl)
}

function registerIpc(api: Api): void {
  for (const domain of Object.keys(API_METHODS) as (keyof Api)[]) {
    for (const method of API_METHODS[domain]) {
      const channel = `${domain}:${String(method)}`
      const schema = (schemas[domain] as Record<string, ZodType>)[method as string]
      const handler = (api[domain] as unknown as Record<string, (arg: unknown) => Promise<unknown>>)[method as string]
      ipcMain.handle(channel, async (event, arg: unknown) => {
        if (!isTrustedSender(event.senderFrame?.url)) throw new Error('Untrusted sender')
        const parsed = schema.safeParse(arg)
        if (!parsed.success) {
          throw new Error(
            `Invalid request for ${channel}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
          )
        }
        return handler(parsed.data)
      })
    }
  }
}

function startApp(): void {
  void app.whenReady().then(ready)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/**
 * `milka run …` and the other commands run in the terminal, without window.
 * Unlike the standalone Node CLI, they can read the secrets typed in the app,
 * once Electron is ready to use the system keyring.
 */
function startCli(args: string[]): void {
  void app
    .whenReady()
    .then(() => {
      const dataDir = app.getPath('userData')
      const secrets = new SecretStore(join(dataDir, 'secrets.json'), createCipher(safeStorage, join(dataDir, 'secrets.key')))
      const registry = new JsonStore<WorkspaceState>(join(dataDir, 'workspaces.json'), () => ({ repos: [], activeRepoId: null }))
      return runCli(args, {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
        cwd: process.cwd(),
        env: process.env,
        color: !!process.stdout.isTTY && !process.env.NO_COLOR,
        version: app.getVersion(),
        secrets(workspacePath, collection, env) {
          const repo = registry.read().repos.find((r) => resolve(r.path) === resolve(workspacePath))
          return repo ? secrets.get(repo.id, secretScope(collection, env)) : {}
        }
      })
    })
    .then((code) => app.exit(code))
}

function ready(): void {
  Menu.setApplicationMenu(null)
  const dataDir = app.getPath('userData')
  const secrets = new SecretStore(join(dataDir, 'secrets.json'), createCipher(safeStorage, join(dataDir, 'secrets.key')))
  const watcher = new WorkspaceWatcher((repoId) => send('workspace:files', { repoId }))
  const watchActive = (state: WorkspaceState): void => {
    const active = state.repos.find((r) => r.id === state.activeRepoId)
    watcher.watch(active?.id ?? null, active?.path ?? null)
  }
  const workspace = new WorkspaceManager(join(dataDir, 'workspaces.json'), join(dataDir, 'workspaces'), secrets, {
    status: (status) => send('workspace:status', status),
    changed: (state) => {
      watchActive(state)
      send('workspace:changed', state)
    }
  })
  watchActive(workspace.state())

  const content = new ContentService(workspace, secrets)
  const settings = new SettingsStore(join(dataDir, 'settings.json'))
  const execution = new ExecutionService(workspace, content, settings)

  registerIpc(
    createHandlers({
      workspace,
      content,
      execution,
      settings,
      window: () => mainWindow,
      secretsEncrypted,
      events: { runnerCase: (payload) => send('runner:case', payload) }
    })
  )
  createWindow()

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    // Push pending workspace changes before leaving.
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000))
    void Promise.race([workspace.flush(), timeout]).finally(() => app.quit())
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// The packaged binary gets its arguments first; `electron .` in development after the app folder.
const args = process.argv.slice(app.isPackaged ? 1 : 2).filter((arg) => !arg.startsWith('--no-sandbox'))
if (args.length > 0 && COMMANDS.includes(args[0])) startCli(args)
else startApp()
