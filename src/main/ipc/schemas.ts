// zod schemas validating every IPC payload coming from the renderer.
import { z } from 'zod'
import type { Api } from '@shared/api'

const none = z.undefined().or(z.object({}).strict())
const repoId = z.string().min(1)
const name = z.string().trim().min(1).max(200)

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
  dialog: {
    openDirectory: z.object({ title: z.string() })
  },
  app: {
    info: none
  }
}
