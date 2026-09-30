// Implementation of the IPC API on top of the main-process services.
import { app } from 'electron'
import type { Api } from '@shared/api'

export function createHandlers(): Api {
  return {
    app: {
      async info() {
        return { version: app.getVersion(), platform: process.platform }
      }
    }
  }
}
