// Implementation of the IPC API on top of the main-process services.
import { app, dialog, type BrowserWindow } from 'electron'
import type { Api } from '@shared/api'
import type { WorkspaceManager } from '../workspace/manager'

export interface Services {
  workspace: WorkspaceManager
  window(): BrowserWindow | null
  secretsEncrypted(): boolean
}

export function createHandlers({ workspace, window, secretsEncrypted }: Services): Api {
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
