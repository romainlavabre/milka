// JSON bodies with `{{variables}}`: a variable may stand for a whole value,
// without quotes (`"id": {{userId}}`), since it is replaced as text before
// sending. Checks and formats such bodies, which JSON.parse refuses.

export interface JsonSyntaxError {
  /** Offsets in the text. */
  start: number
  end: number
  message: string
}

const VARIABLE = /\{\{\s*[^{}\s]+\s*\}\}/y
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const LITERAL = /true|false|null/y

class Fail {
  constructor(readonly error: JsonSyntaxError) {}
}

/** The first syntax error of a JSON body, `{{variables}}` accepted as values and keys; null when valid or empty. */
export function jsonSyntaxError(text: string): JsonSyntaxError | null {
  let i = 0
  const fail = (message: string, start = i, end = Math.min(start + 1, text.length)): never => {
    throw new Fail({ start, end: Math.max(end, start), message })
  }
  const space = (): void => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++
  }
  const match = (pattern: RegExp): boolean => {
    pattern.lastIndex = i
    if (!pattern.test(text)) return false
    i = pattern.lastIndex
    return true
  }
  const string = (): void => {
    const start = i++
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\n') fail('Unterminated string', start, i)
      if (text[i] < ' ') fail('Control character in a string')
      if (text[i] === '\\') {
        const escape = text[i + 1] ?? ''
        const valid = escape === 'u' ? /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6)) : escape !== '' && '"\\/bfnrt'.includes(escape)
        if (!valid) fail('Invalid escape', i, i + 2)
        i += escape === 'u' ? 6 : 2
      } else i++
    }
    if (i >= text.length) fail('Unterminated string', start, i)
    i++
  }
  const key = (): void => {
    if (text[i] === '"') string()
    else if (!match(VARIABLE)) fail('Property name expected')
  }
  const value = (): void => {
    space()
    const c = text[i]
    if (c === undefined) fail('Value expected')
    if (match(VARIABLE)) return
    if (c === '{') return container('}', () => {
      key()
      space()
      if (text[i] !== ':') fail('Colon expected')
      i++
      value()
    })
    if (c === '[') return container(']', value)
    if (c === '"') return string()
    if (match(NUMBER) || match(LITERAL)) return
    fail('Value expected')
  }
  const container = (close: string, item: () => void): void => {
    const open = i++
    space()
    if (text[i] === close) {
      i++
      return
    }
    let comma = -1
    for (;;) {
      space()
      if (comma >= 0 && text[i] === close) fail('Trailing comma', comma)
      item()
      space()
      if (text[i] === ',') {
        comma = i++
        continue
      }
      if (text[i] === close) {
        i++
        return
      }
      if (i >= text.length) fail(`Unclosed ${text[open]}`, open)
      fail(`Comma or ${close} expected`)
    }
  }

  if (!text.trim()) return null
  try {
    value()
    space()
    if (i < text.length) fail('End of file expected', i, text.length)
    return null
  } catch (error) {
    if (error instanceof Fail) return error.error
    throw error
  }
}

/** Indents a JSON body, keeping its unquoted `{{variables}}`; throws when it is not valid. */
export function formatJsonTemplate(text: string, indent = 2): string {
  const error = jsonSyntaxError(text)
  if (error) throw new Error(`${error.message} at offset ${error.start}`)
  // Variables outside strings become marked strings, put back after formatting.
  const variables: string[] = []
  let quoted = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    if (inString) {
      if (text[i] === '\\') quoted += text[i++]
      else if (text[i] === '"') inString = false
      quoted += text[i]
      continue
    }
    VARIABLE.lastIndex = i
    const variable = VARIABLE.exec(text)
    if (variable) {
      quoted += `"\\u0001${variables.length}\\u0001"`
      variables.push(variable[0])
      i += variable[0].length - 1
      continue
    }
    if (text[i] === '"') inString = true
    quoted += text[i]
  }
  return JSON.stringify(JSON.parse(quoted), null, indent).replace(/"\\u0001(\d+)\\u0001"/g, (_, n: string) => variables[Number(n)])
}
