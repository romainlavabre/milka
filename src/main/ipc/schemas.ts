// zod schemas validating every IPC payload coming from the renderer.
import { z } from 'zod'
import type { Api } from '@shared/api'
import { collectionSchema, environmentSchema, folderSchema, requestSchema } from '@core/model'

const none = z.undefined().or(z.object({}).strict())
const repoId = z.string().min(1)
const name = z.string().trim().min(1).max(200)
// Paths are checked again against the collection folder by the store.
const collection = z.string().min(1).max(200)
const nodePath = z.string().min(1).max(1000)
const env = z.string().min(1).max(200)

export const schemas: { [D in keyof Api]: { [M in keyof Api[D]]: z.ZodType } } = {
  workspace: {
    state: none,
    clone: z.object({ name, remoteUrl: z.string().trim().min(1), path: z.string().optional() }),
    open: z.object({ name, path: z.string().min(1) }),
    create: z.object({ name, path: z.string().optional() }),
    rename: z.object({ repoId, name }),
    remove: z.object({ repoId, deleteFiles: z.boolean() }),
    activate: z.object({ repoId }),
    setRemote: z.object({ repoId, remoteUrl: z.string().trim().min(1) }),
    status: z.object({ repoId }),
    sync: z.object({ repoId }),
    resolveConflicts: z.object({ repoId, choices: z.record(z.string(), z.enum(['mine', 'theirs'])) })
  },
  collections: {
    list: none,
    get: z.object({ collection }),
    save: z.object({ collection: collection.nullable(), data: collectionSchema }),
    remove: z.object({ collection }),
    getFolder: z.object({ collection, path: nodePath }),
    saveFolder: z.object({ collection, parent: z.string(), path: nodePath.nullable(), data: folderSchema }),
    removeFolder: z.object({ collection, path: nodePath }),
    getRequest: z.object({ collection, path: nodePath }),
    saveRequest: z.object({ collection, parent: z.string(), path: nodePath.nullable(), data: requestSchema }),
    duplicateRequest: z.object({ collection, path: nodePath }),
    removeRequest: z.object({ collection, path: nodePath }),
    move: z.object({ collection, from: nodePath, parent: z.string(), before: nodePath.nullable() }),
    variableNames: z.object({ collection })
  },
  environments: {
    list: z.object({ collection }),
    get: z.object({ collection, env }),
    save: z.object({ collection, env: env.nullable(), data: environmentSchema, secretValues: z.record(z.string(), z.string()) }),
    remove: z.object({ collection, env })
  },
  http: {
    send: z.object({
      requestId: z.string().min(1),
      collection,
      path: nodePath,
      request: requestSchema.optional(),
      bodyName: z.string().nullable().optional(),
      env: env.nullable()
    }),
    cancel: z.object({ requestId: z.string() }),
    runtimeVars: none,
    clearRuntimeVars: none
  },
  importer: {
    collection: z
      .object({ format: z.enum(['bruno', 'postman', 'openapi']), path: z.string().min(1).optional(), text: z.string().optional() })
      .refine((a) => a.path !== undefined || a.text !== undefined, 'path or text is required'),
    environment: z.object({ collection, path: z.string().min(1) }),
    curl: z.object({ collection, parent: z.string(), command: z.string().min(1) })
  },
  exporter: {
    openapi: z.object({ collection, file: z.string().min(1) })
  },
  runner: {
    run: z.object({
      runId: z.string().min(1),
      collection,
      path: z.string(),
      env: env.nullable(),
      allBodies: z.boolean(),
      bail: z.boolean(),
      tags: z.array(z.string())
    }),
    cancel: z.object({ runId: z.string() })
  },
  settings: {
    get: none,
    set: z.object({ insecureTls: z.boolean().optional() })
  },
  dialog: {
    openDirectory: z.object({ title: z.string() }),
    openFile: z.object({ title: z.string(), filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional() }),
    saveFile: z.object({
      title: z.string(),
      defaultName: z.string(),
      filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional()
    })
  },
  app: {
    info: none
  },
  update: {
    status: none,
    install: none,
    openTerminal: none,
    restart: none
  }
}
