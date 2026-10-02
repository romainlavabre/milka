import { describe, expect, it } from 'vitest'
import { filterCompletions, insertVariable, isBuiltinVariable, openVariableAt, variableTokens } from '@core/varSyntax'

describe('variable syntax', () => {
  it('finds every {{variable}} with its position, padded or not', () => {
    const text = '{{baseUrl}}/users/{{ id }}?q={{ not closed'
    expect(variableTokens(text)).toEqual([
      { start: 0, end: 11, name: 'baseUrl' },
      { start: 18, end: 26, name: 'id' }
    ])
    expect(text.slice(18, 26)).toBe('{{ id }}')
  })

  it('finds the {{ being typed before the caret', () => {
    expect(openVariableAt('{{', 2)).toEqual({ from: 2, to: 2, query: '' })
    expect(openVariableAt('{{ba', 4)).toEqual({ from: 2, to: 4, query: 'ba' })
    expect(openVariableAt('{{a}}/{{b', 9)).toEqual({ from: 8, to: 9, query: 'b' })
    expect(openVariableAt('x{{ba', 1)).toBeNull()
    expect(openVariableAt('{{a b', 5)).toBeNull()
    expect(openVariableAt('{ba', 3)).toBeNull()
    expect(openVariableAt('{{{', 3)).toBeNull()
  })

  it('runs the range over the rest of the name and over a closing }} already typed', () => {
    expect(openVariableAt('{{}}', 2)).toEqual({ from: 2, to: 4, query: '' })
    expect(openVariableAt('"{{bau}}"', 4)).toEqual({ from: 3, to: 8, query: 'b' })
  })

  it('completes the open variable and puts the caret after it', () => {
    const text = '{{bas/users'
    expect(insertVariable(text, openVariableAt(text, 5)!, 'baseUrl')).toEqual({ text: '{{baseUrl}}/users', caret: 11 })
    expect(insertVariable('{{}}', openVariableAt('{{}}', 2)!, 'id')).toEqual({ text: '{{id}}', caret: 6 })
  })

  it('filters the names, those starting with the query first', () => {
    const items = [{ name: 'token' }, { name: 'baseUrl' }, { name: 'userBase' }, { name: 'id' }]
    expect(filterCompletions(items, 'BA').map((i) => i.name)).toEqual(['baseUrl', 'userBase'])
    expect(filterCompletions(items, '')).toEqual(items)
  })

  it('knows the built-in variables', () => {
    expect(['$uuid', '$timestamp', '$isoTimestamp', '$randomInt', 'process.env.HOME'].every(isBuiltinVariable)).toBe(true)
    expect(isBuiltinVariable('uuid')).toBe(false)
  })
})
