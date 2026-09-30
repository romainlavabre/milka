// Turns a cURL command (as copied from a browser's dev tools or API docs) into a request.
import { newBody, newRequest, type Auth, type Body, type FormField, type HttpRequest, type KeyValue, type Param } from '../model'

/** Splits a shell command line into words: quotes, escapes and line continuations. */
export function shellWords(command: string): string[] {
  const words: string[] = []
  let current = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  const text = command.replace(/\\\r?\n/g, ' ')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
    } else if (quote === '"') {
      if (char === '"') quote = null
      else if (char === '\\' && i + 1 < text.length && '"\\$`'.includes(text[i + 1])) current += text[++i]
      else current += char
    } else if (char === "'" || char === '"') {
      quote = char
      inWord = true
    } else if (char === '$' && text[i + 1] === "'") {
      // Bash ANSI-C quoting, used by Chrome's "Copy as cURL".
      i += 2
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[++i]
          current += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
        } else current += text[i]
        i++
      }
      inWord = true
    } else if (char === '\\' && i + 1 < text.length) {
      current += text[++i]
      inWord = true
    } else if (/\s/.test(char)) {
      if (inWord) words.push(current)
      current = ''
      inWord = false
    } else {
      current += char
      inWord = true
    }
  }
  if (quote) throw new Error('Unterminated quote in the cURL command')
  if (inWord) words.push(current)
  return words
}

const WITH_VALUE = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '--json',
  '-F',
  '--form',
  '--form-string',
  '-u',
  '--user',
  '--url',
  '-A',
  '--user-agent',
  '-b',
  '--cookie',
  '-e',
  '--referer',
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-x',
  '--proxy',
  '-w',
  '--write-out',
  '--cacert',
  '--cert',
  '--key'
])

function keyValue(name: string, value: string): KeyValue {
  return { name, value, enabled: true, description: '' }
}

export function importCurl(command: string): HttpRequest {
  const words = shellWords(command.trim())
  if (words[0] !== 'curl') throw new Error('The command must start with curl')
  let method: string | null = null
  let url = ''
  let get = false
  const headers: KeyValue[] = []
  const data: string[] = []
  let json = false
  const form: FormField[] = []
  let auth: Auth | null = null

  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    const option = word.startsWith('--') && word.includes('=') ? word.slice(0, word.indexOf('=')) : word
    const inline = option !== word ? word.slice(option.length + 1) : undefined
    const value = (): string => inline ?? words[++i] ?? ''
    if (!word.startsWith('-')) {
      url = word
      continue
    }
    if (!WITH_VALUE.has(option)) {
      if (option === '-G' || option === '--get') get = true
      else if (option === '-I' || option === '--head') method = 'HEAD'
      continue
    }
    const v = value()
    switch (option) {
      case '-X':
      case '--request':
        method = v.toUpperCase()
        break
      case '-H':
      case '--header': {
        const colon = v.indexOf(':')
        if (colon > 0) headers.push(keyValue(v.slice(0, colon).trim(), v.slice(colon + 1).trim()))
        break
      }
      case '--json':
        json = true
        data.push(v)
        break
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
      case '--data-urlencode':
        data.push(v)
        break
      case '-F':
      case '--form':
      case '--form-string': {
        const eq = v.indexOf('=')
        const name = eq === -1 ? v : v.slice(0, eq)
        const raw = eq === -1 ? '' : v.slice(eq + 1)
        const isFile = option !== '--form-string' && raw.startsWith('@')
        form.push({
          name,
          value: isFile ? raw.slice(1).split(';')[0] : raw,
          enabled: true,
          description: '',
          type: isFile ? 'file' : 'text'
        })
        break
      }
      case '-u':
      case '--user': {
        const [username, ...password] = v.split(':')
        auth = { type: 'basic', username, password: password.join(':'), token: '', key: '', value: '', in: 'header' }
        break
      }
      case '--url':
        url = v
        break
      case '-A':
      case '--user-agent':
        headers.push(keyValue('User-Agent', v))
        break
      case '-b':
      case '--cookie':
        headers.push(keyValue('Cookie', v))
        break
      case '-e':
      case '--referer':
        headers.push(keyValue('Referer', v))
        break
    }
  }
  if (!url) throw new Error('No URL found in the cURL command')

  const [base, query = ''] = url.split('?')
  const params: Param[] = query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [name, ...rest] = pair.split('=')
      return { ...keyValue(name, rest.join('=')), type: 'query' as const }
    })

  let bodies: Body[] = []
  const contentType = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? ''
  if (form.length) {
    bodies = [{ ...newBody('Default', 'multipart'), fields: form }]
    // The multipart boundary is generated when sending.
    const index = headers.findIndex((h) => h.name.toLowerCase() === 'content-type')
    if (index !== -1) headers.splice(index, 1)
  } else if (data.length && get) {
    for (const pair of data.join('&').split('&')) {
      const [name, ...rest] = pair.split('=')
      params.push({ ...keyValue(name, rest.join('=')), type: 'query' })
    }
  } else if (data.length) {
    const content = data.join('&')
    const isJson = json || /json/i.test(contentType) || /^\s*[[{]/.test(content)
    if (isJson) {
      let pretty = content
      try {
        pretty = JSON.stringify(JSON.parse(content), null, 2)
      } catch {
        // Kept as typed.
      }
      bodies = [newBody('Default', 'json', pretty)]
    } else if (!contentType || /x-www-form-urlencoded/i.test(contentType)) {
      bodies = [
        {
          ...newBody('Default', 'form'),
          fields: content.split('&').map((pair) => {
            const [name, ...rest] = pair.split('=')
            return { ...keyValue(decodeURIComponent(name), decodeURIComponent(rest.join('='))), type: 'text' as const }
          })
        }
      ]
    } else bodies = [newBody('Default', /xml/i.test(contentType) ? 'xml' : 'text', content)]
    if (bodies[0].type === 'json' && !contentType && json) headers.push(keyValue('Content-Type', 'application/json'))
  }

  const pathName = (() => {
    try {
      return new URL(base).pathname
    } catch {
      return base
    }
  })()
  const finalMethod = method ?? (data.length && !get ? 'POST' : form.length ? 'POST' : 'GET')
  return newRequest(`${finalMethod} ${pathName}`.trim(), {
    method: finalMethod,
    url: base,
    params,
    headers: headers.filter((h) => !(bodies[0]?.type === 'form' && h.name.toLowerCase() === 'content-type')),
    bodies,
    activeBody: bodies[0]?.name ?? null,
    ...(auth ? { auth } : {})
  })
}
