// Implementation of the IPC API on top of the main-process services.
import { app, dialog, type BrowserWindow } from 'electron'
import type { Api } from '@shared/api'
import type { ContentService } from '../workspace/content'
import type { WorkspaceManager } from '../workspace/manager'

export interface Services {
  workspace: WorkspaceManager
  content: ContentService
  window(): BrowserWindow | null
  secretsEncrypted(): boolean
}

export function createHandlers({ workspace, content, window, secretsEncrypted }: Services): Api {
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
      move: ({ collection, from, parent, before }) => content.move(collection, from, parent, before)
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
    dialog: {
      async openDirectory({ title }) {
        const win = window()
        const options = { title, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }
    },
    app: {
      async info() {
        return { version: app.getVersion(), platform: process.platform, secretsEncrypted: secretsEncrypted() }
      }
    }
  }
}
