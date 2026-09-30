// zod schemas validating every IPC payload coming from the renderer.
import { z } from 'zod'
import type { Api } from '@shared/api'

const none = z.undefined().or(z.object({}).strict())

export const schemas: { [D in keyof Api]: { [M in keyof Api[D]]: z.ZodType } } = {
  app: {
    info: none
  }
}
