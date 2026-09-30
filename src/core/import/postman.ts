// Imports a Postman collection (v2.1) and Postman environments. The request
// bodies of saved examples become extra bodies of the request.
import {
  newBody,
  newCollection,
  newEnvironment,
  newFolder,
  newRequest,
  type Auth,
  type Body,
  type Environment,
  type FormField,
  type KeyValue,
  type Param
} from '../model'
import { convertScript, type ImportedCollection, type ImportedItem } from './imported'

interface PmKeyValue {
  key?: string
  value?: unknown
  disabled?: boolean
  description?: string | { content?: string }
  type?: string
  src?: string | string[]
}

interface PmUrl {
  raw?: string
  query?: PmKeyValue[]
  variable?: PmKeyValue[]
}

interface PmBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'graphql' | 'file' | 'none'
  raw?: string
  urlencoded?: PmKeyValue[]
  formdata?: PmKeyValue[]
  graphql?: { query?: string; variables?: string }
  file?: { src?: string }
  options?: { raw?: { language?: string } }
}

interface PmAuth {
  type?: string
  basic?: PmKeyValue[]
  bearer?: PmKeyValue[]
  apikey?: PmKeyValue[]
}

interface PmRequest {
  method?: string
  url?: string | PmUrl
  header?: PmKeyValue[]
  body?: PmBody
  auth?: PmAuth
  description?: string | { content?: string }
}

interface PmEvent {
  listen?: 'prerequest' | 'test'
  script?: { exec?: string | string[] }
}

interface PmItem {
  name?: string
  item?: PmItem[]
  request?: PmRequest | string
  response?: { name?: string; originalRequest?: PmRequest }[]
  event?: PmEvent[]
  auth?: PmAuth
  variable?: PmKeyValue[]
  description?: string | { content?: string }
}

interface PmCollection {
  info?: { name?: string; schema?: string; description?: string | { content?: string } }
  item?: PmItem[]
  variable?: PmKeyValue[]
  auth?: PmAuth
  event?: PmEvent[]
}

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object' && 'content' in (value as object)) return String((value as { content?: string }).content ?? '')
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function rows(list: PmKeyValue[] | undefined): KeyValue[] {
  return (list ?? [])
    .filter((r) => r.key)
    .map((r) => ({ name: r.key!, value: text(r.value), enabled: !r.disabled, description: text(r.description) }))
}

function authOf(pm: PmAuth | undefined, fallback: Auth['type']): Auth {
  const base: Auth = { type: fallback, username: '', password: '', token: '', key: '', value: '', in: 'header' }
  if (!pm?.type) return base
  const get = (list: PmKeyValue[] | undefined, key: string): string => text(list?.find((r) => r.key === key)?.value)
  switch (pm.type) {
    case 'noauth':
      return { ...base, type: 'none' }
    case 'basic':
      return { ...base, type: 'basic', username: get(pm.basic, 'username'), password: get(pm.basic, 'password') }
    case 'bearer':
      return { ...base, type: 'bearer', token: get(pm.bearer, 'token') }
    case 'apikey':
      return {
        ...base,
        type: 'apikey',
        key: get(pm.apikey, 'key'),
        value: get(pm.apikey, 'value'),
        in: get(pm.apikey, 'in') === 'query' ? 'query' : 'header'
      }
    default:
      return base
  }
}

function scripts(events: PmEvent[] | undefined): { pre: string; post: string } {
  const code = (listen: string): string => {
    const exec = events?.find((e) => e.listen === listen)?.script?.exec
    return convertScript(Array.isArray(exec) ? exec.join('\n') : (exec ?? ''), 'Postman')
  }
  // Postman "tests" run after the response: Milka's post-response script.
  return { pre: code('prerequest'), post: code('test') }
}

function bodyOf(pm: PmBody | undefined, name: string): Body | null {
  if (!pm?.mode || pm.mode === 'none') return null
  switch (pm.mode) {
    case 'raw': {
      const language = pm.options?.raw?.language
      const content = pm.raw ?? ''
      if (!content.trim()) return null
      const type = language === 'json' || /^\s*[[{]/.test(content) ? 'json' : language === 'xml' ? 'xml' : 'text'
      return newBody(name, type, content)
    }
    case 'urlencoded':
      return { ...newBody(name, 'form'), fields: rows(pm.urlencoded).map((f) => ({ ...f, type: 'text' as const })) }
    case 'formdata':
      return {
        ...newBody(name, 'multipart'),
        fields: (pm.formdata ?? [])
          .filter((r) => r.key)
          .map((r): FormField => {
            const isFile = r.type === 'file'
            const src = Array.isArray(r.src) ? r.src[0] : r.src
            return {
              name: r.key!,
              value: isFile ? (src ?? '') : text(r.value),
              enabled: !r.disabled,
              description: '',
              type: isFile ? 'file' : 'text'
            }
          })
      }
    case 'graphql':
      return { ...newBody(name, 'graphql', pm.graphql?.query ?? ''), variables: pm.graphql?.variables ?? '' }
    case 'file':
      return newBody(name, 'binary', pm.file?.src ?? '')
  }
}

function urlOf(url: PmRequest['url']): { url: string; params: Param[] } {
  if (!url) return { url: '', params: [] }
  const raw = typeof url === 'string' ? url : (url.raw ?? '')
  const base = raw.split('?')[0]
  const query =
    typeof url === 'string'
      ? (raw.split('?')[1] ?? '')
          .split('&')
          .filter(Boolean)
          .map((pair): KeyValue => {
            const [name, ...value] = pair.split('=')
            return { name, value: value.join('='), enabled: true, description: '' }
          })
      : rows(url.query)
  const path = typeof url === 'string' ? [] : rows(url.variable)
  return {
    url: base,
    params: [...path.map((p) => ({ ...p, type: 'path' as const })), ...query.map((p) => ({ ...p, type: 'query' as const }))]
  }
}

function toItem(item: PmItem, warnings: string[]): ImportedItem | null {
  if (item.item) {
    return {
      kind: 'folder',
      folder: {
        ...newFolder(item.name || 'Folder'),
        auth: authOf(item.auth, 'inherit'),
        scripts: scripts(item.event),
        vars: rows(item.variable),
        docs: text(item.description)
      },
      items: item.item.map((child) => toItem(child, warnings)).filter((i): i is ImportedItem => i !== null)
    }
  }
  if (!item.request) return null
  const request: PmRequest = typeof item.request === 'string' ? { method: 'GET', url: item.request } : item.request
  const bodies: Body[] = []
  const main = bodyOf(request.body, 'Default')
  if (main) bodies.push(main)
  for (const example of item.response ?? []) {
    const body = bodyOf(example.originalRequest?.body, example.name || `Example ${bodies.length + 1}`)
    if (body && !bodies.some((b) => b.content === body.content && b.type === body.type)) {
      bodies.push({ ...body, name: bodies.some((b) => b.name === body.name) ? `${body.name} ${bodies.length + 1}` : body.name })
    }
  }
  const { url, params } = urlOf(request.url)
  return {
    kind: 'request',
    request: newRequest(item.name || 'Request', {
      method: (request.method ?? 'GET').toUpperCase(),
      url,
      params,
      headers: rows(request.header),
      auth: authOf(request.auth, 'inherit'),
      bodies,
      activeBody: bodies[0]?.name ?? null,
      scripts: scripts(item.event),
      docs: text(request.description ?? item.description)
    })
  }
}

export function importPostman(json: string): ImportedCollection {
  const data = JSON.parse(json) as PmCollection
  if (!data.info || !Array.isArray(data.item)) throw new Error('Not a Postman collection (expected "info" and "item")')
  if (data.info.schema && !/v2\.[01]/.test(data.info.schema)) throw new Error('Only Postman collections v2.0 and v2.1 are supported')
  const warnings: string[] = []
  const items = data.item.map((item) => toItem(item, warnings)).filter((i): i is ImportedItem => i !== null)
  const hasScripts = JSON.stringify(data).includes('"exec"')
  if (hasScripts) warnings.push('Scripts were converted from the pm API where possible: check them before use.')
  return {
    collection: {
      ...newCollection(data.info.name || 'Postman collection'),
      vars: rows(data.variable),
      auth: authOf(data.auth, 'none'),
      scripts: scripts(data.event),
      docs: text(data.info.description)
    },
    environments: [],
    items,
    warnings
  }
}

/** A Postman environment export; secret variables keep their name only. */
export function importPostmanEnvironment(json: string): Environment {
  const data = JSON.parse(json) as { name?: string; values?: (PmKeyValue & { enabled?: boolean })[] }
  if (!Array.isArray(data.values)) throw new Error('Not a Postman environment (expected "values")')
  const secret = (r: PmKeyValue): boolean => r.type === 'secret'
  return {
    ...newEnvironment(data.name || 'Environment'),
    vars: data.values
      .filter((r) => r.key && !secret(r))
      .map((r) => ({ name: r.key!, value: text(r.value), enabled: r.enabled !== false, description: '' })),
    secrets: data.values.filter((r) => r.key && secret(r)).map((r) => r.key!)
  }
}
