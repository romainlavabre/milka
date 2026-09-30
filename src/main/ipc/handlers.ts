// Implementation of the IPC API on top of the main-process services.
import { app, clipboard, dialog, type BrowserWindow } from 'electron'
import type { Api, ApiEvents } from '@shared/api'
import type { ExecutionService } from '../execution'
import type { SettingsStore } from '../settings'
import { updateCommand, type Updater } from '../update'
import type { ContentService } from '../workspace/content'
import type { WorkspaceManager } from '../workspace/manager'

export interface Services {
  workspace: WorkspaceManager
  content: ContentService
  execution: ExecutionService
  settings: SettingsStore
  updater: Updater
  window(): BrowserWindow | null
  /** Closes the window without asking the renderer again. */
  closeWindow(): void
  secretsEncrypted(): boolean
  events: { runnerCase(payload: ApiEvents['runner:case']): void }
}

export function createHandlers({
  workspace,
  content,
  execution,
  settings,
  updater,
  window,
  closeWindow,
  secretsEncrypted,
  events
}: Services): Api {
  return {
    workspace: {
      async state() {
        return workspace.state()
      },
      clone: ({ name, remoteUrl, path }) => workspace.clone(name, remoteUrl, path),
      open: ({ name, path }) => workspace.open(name, path),
      create: ({ name, path }) => workspace.create(name, path),
      async rename({ repoId, name }) {
        return workspace.rename(repoId, name)
      },
      async remove({ repoId, deleteFiles }) {
        return workspace.remove(repoId, deleteFiles)
      },
      activate: ({ repoId }) => workspace.activate(repoId),
      setRemote: ({ repoId, remoteUrl }) => workspace.setRemote(repoId, remoteUrl),
      status: ({ repoId }) => workspace.status(repoId),
      sync: ({ repoId }) => workspace.sync(repoId),
      resolveConflicts: ({ repoId, choices }) => workspace.resolveConflicts(repoId, choices)
    },
    collections: {
      async list() {
        return content.listCollections()
      },
      async get({ collection }) {
        return content.getCollection(collection)
      },
      save: ({ collection, data }) => content.saveCollection(collection, data),
      remove: ({ collection }) => content.removeCollection(collection),
      async getFolder({ collection, path }) {
        return content.getFolder(collection, path)
      },
      saveFolder: ({ collection, parent, path, data }) => content.saveFolder(collection, parent, path, data),
      removeFolder: ({ collection, path }) => content.removeFolder(collection, path),
      async getRequest({ collection, path }) {
        return content.getRequest(collection, path)
      },
      saveRequest: ({ collection, parent, path, data }) => content.saveRequest(collection, parent, path, data),
      duplicateRequest: ({ collection, path }) => content.duplicateRequest(collection, path),
      removeRequest: ({ collection, path }) => content.removeRequest(collection, path),
      move: ({ collection, from, parent, before }) => content.move(collection, from, parent, before),
      async variableNames({ collection }) {
        return [...new Set([...content.variableNames(collection), ...Object.keys(execution.runtimeVars())])].sort()
      },
      async visibleVariables({ collection, folder, env }) {
        return [...new Set([...content.visibleVariables(collection, folder, env), ...Object.keys(execution.runtimeVars())])].sort()
      }
    },
    environments: {
      async list({ collection }) {
        return content.listEnvironments(collection)
      },
      async get({ collection, env }) {
        return content.getEnvironment(collection, env)
      },
      save: ({ collection, env, data, secretValues }) => content.saveEnvironment(collection, env, data, secretValues),
      remove: ({ collection, env }) => content.removeEnvironment(collection, env)
    },
    http: {
      send: (args) => execution.send(args),
      async cancel({ requestId }) {
        execution.cancel(requestId)
      },
      async runtimeVars() {
        return { ...execution.runtimeVars() }
      },
      async clearRuntimeVars() {
        execution.clearRuntimeVars()
      },
      async cookies() {
        return execution.cookies().list()
      },
      async deleteCookie({ domain, path, name }) {
        execution.cookies().remove(domain, path, name)
      },
      async clearCookies() {
        execution.cookies().clear()
      }
    },
    importer: {
      async collection({ format, path, text }) {
        const { slug, requests, warnings } = await content.importCollection(format, { path, text })
        return { slug, requests, warnings }
      },
      environment: ({ collection, path }) => content.importEnvironment(collection, path),
      curl: ({ collection, parent, command }) => content.importCurl(collection, parent, command)
    },
    exporter: {
      async openapi({ collection, file }) {
        content.exportOpenApi(collection, file)
      }
    },
    runner: {
      run: (args) => execution.run(args, (runCase, index, total) => events.runnerCase({ runId: args.runId, runCase, index, total })),
      async cancel({ runId }) {
        execution.cancel(runId)
      }
    },
    settings: {
      async get() {
        return settings.read()
      },
      async set(patch) {
        return settings.update((current) => ({ ...current, ...patch }))
      }
    },
    dialog: {
      async openDirectory({ title }) {
        const win = window()
        const options = { title, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      },
      async saveFile({ title, defaultName, filters }) {
        const win = window()
        const options = { title, defaultPath: defaultName, filters }
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        return result.canceled ? null : (result.filePath ?? null)
      },
      async openFile({ title, filters }) {
        const win = window()
        const options = { title, filters, properties: ['openFile'] as 'openFile'[] }
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }
    },
    app: {
      async info() {
        return { version: app.getVersion(), platform: process.platform, secretsEncrypted: secretsEncrypted() }
      },
      async close() {
        closeWindow()
      }
    },
    update: {
      status: async () => updater.getStatus(),
      install: () => updater.install(),
      async openTerminal() {
        const command = updateCommand(updater.getStatus().kind)
        if (await updater.openTerminal()) return { command, copied: false }
        clipboard.writeText(command)
        return { command, copied: true }
      },
      async restart() {
        app.relaunch({ execPath: updater.relaunchPath(), args: process.argv.slice(1) })
        app.quit()
      }
    }
  }
}
