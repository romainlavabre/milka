import { describe, expect, it } from 'vitest'
import { isBuiltinVariable, variableTokens } from '@core/varSyntax'

describe('variable syntax', () => {
  it('finds every {{variable}} with its position, padded or not', () => {
    const text = '{{baseUrl}}/users/{{ id }}?q={{ not closed'
    expect(variableTokens(text)).toEqual([
      { start: 0, end: 11, name: 'baseUrl' },
      { start: 18, end: 26, name: 'id' }
    ])
    expect(text.slice(18, 26)).toBe('{{ id }}')
  })

  it('knows the built-in variables', () => {
    expect(['$uuid', '$timestamp', '$isoTimestamp', '$randomInt', 'process.env.HOME'].every(isBuiltinVariable)).toBe(true)
    expect(isBuiltinVariable('uuid')).toBe(false)
  })
})
