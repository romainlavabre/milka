import { describe, expect, it } from 'vitest'
import { formatJsonTemplate, jsonSyntaxError } from '@core/jsonTemplate'

describe('jsonSyntaxError', () => {
  it('accepts JSON with unquoted variables', () => {
    for (const text of [
      '',
      '  ',
      '{ "id": {{saleInvoiceId}}, "name": "{{name}}" }',
      '[{{a}}, {{ b }}, 1, -2.5e3, true, null, "x\\n\\u00e9"]',
      '{ {{key}}: 1 }',
      '{{body}}',
      '{"a": {"b": []}, "c": {}}'
    ])
      expect(jsonSyntaxError(text), text).toBeNull()
  })

  it('locates the errors', () => {
    expect(jsonSyntaxError('{ "a": }')).toEqual({ start: 7, end: 8, message: 'Value expected' })
    expect(jsonSyntaxError('{ "a": 1, }')).toEqual({ start: 8, end: 9, message: 'Trailing comma' })
    expect(jsonSyntaxError('{ "a" 1 }')).toMatchObject({ start: 6, message: 'Colon expected' })
    expect(jsonSyntaxError('{ "a": 1 "b": 2 }')).toMatchObject({ start: 9, message: 'Comma or } expected' })
    expect(jsonSyntaxError('{ "a": 1')).toMatchObject({ start: 0, message: 'Unclosed {' })
    expect(jsonSyntaxError('{ "a": "x }')).toMatchObject({ start: 7, message: 'Unterminated string' })
    expect(jsonSyntaxError('{ a: 1 }')).toMatchObject({ start: 2, message: 'Property name expected' })
    expect(jsonSyntaxError('{} x')).toMatchObject({ start: 3, end: 4, message: 'End of file expected' })
    // An empty {{ }} is no variable: an object inside an object.
    expect(jsonSyntaxError('{ "a": {{ }} }')).toMatchObject({ start: 8, message: 'Property name expected' })
  })
})

describe('formatJsonTemplate', () => {
  it('indents and keeps the variables', () => {
    expect(formatJsonTemplate('{"item":{"id":{{saleInvoiceId}},"name":"{{name}} x","tags":[{{tag}}]}}')).toBe(
      '{\n  "item": {\n    "id": {{saleInvoiceId}},\n    "name": "{{name}} x",\n    "tags": [\n      {{tag}}\n    ]\n  }\n}'
    )
  })

  it('refuses invalid JSON', () => {
    expect(() => formatJsonTemplate('{ "a": }')).toThrow('Value expected at offset 7')
  })
})
