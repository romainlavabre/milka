import { describe, expect, it } from 'vitest'
import { BUILTIN_VARIABLES, builtinVariable } from '@core/vars'

describe('built-in variables', () => {
  it('resolves every built-in it documents', () => {
    for (const { name } of BUILTIN_VARIABLES) expect(builtinVariable(name, { NAME: 'value' }), name).toBeDefined()
  })
})
