// Imports a Bruno collection saved in the YAML format of Bruno 3 (OpenCollection):
// opencollection.yml, folder.yml, one .yml file per request and environments/*.yml.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import {
  ASSERT_OPERATORS,
  newBody,
  newCollection,
  newEnvironment,
  newFolder,
  newRequest,
  type Assertion,
  type AssertOperator,
  type Auth,
  type Body,
  type Environment,
  type FormField,
  type HttpRequest,
  type KeyValue,
  type Param
} from '../model'
import { convertScript, type ImportedCollection, type ImportedItem } from './imported'

type Node = Record<string, unknown>
type Warn = (message: string) => void

const node = (value: unknown): Node => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : {})
const nodes = (value: unknown): Node[] => (Array.isArray(value) ? value.map(node) : [])
const text = (value: unknown): string =>
  value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
const isEnabled = (row: Node): boolean => row.disabled !== true && row.enabled !== false

function readYaml(path: string): Node {
  return node(parse(readFileSync(path, 'utf8')))
}

const isYaml = (name: string): boolean => name.endsWith('.yml') || name.endsWith('.yaml')

function keyValues(value: unknown): KeyValue[] {
  return nodes(value)
    .filter((row) => text(row.name))
    .map((row) => ({ name: text(row.name), value: text(row.value), enabled: isEnabled(row), description: text(row.description) }))
}

/** Docs are a markdown string, or `{ content, type }`. */
function docs(value: unknown): string {
  return typeof value === 'string' ? value : text(node(value).content)
}

function auth(value: unknown, fallback: Auth['type'], warn: Warn): Auth {
  const base: Auth = { type: fallback, username: '', password: '', token: '', key: '', value: '', in: 'header' }
  // `auth: inherit` is a plain string; the other modes are objects with a type.
  const config = typeof value === 'string' ? { type: value } : node(value)
  switch (config.type) {
    case undefined:
      return base
    case 'inherit':
    case 'none':
      return { ...base, type: config.type }
    case 'basic':
      return { ...base, type: 'basic', username: text(config.username), password: text(config.password) }
    case 'bearer':
      return { ...base, type: 'bearer', token: text(config.token) }
    case 'apikey':
      return {
        ...base,
        type: 'apikey',
        key: text(config.key),
        value: text(config.value),
        in: /query/i.test(text(config.placement)) ? 'query' : 'header'
      }
    default:
      warn(`${text(config.type)} auth is not supported yet: set it again in Milka`)
      return base
  }
}

/** Scripts are a list of `{ type, code }`, tests included. */
function scripts(value: unknown): { scripts: { pre: string; post: string }; tests: string } {
  const code = (...types: string[]): string =>
    convertScript(
      nodes(value)
        .filter((script) => types.includes(text(script.type)))
        .map((script) => text(script.code))
        .filter((c) => c.trim())
        .join('\n\n'),
      'Bruno'
    )
  return {
    scripts: { pre: code('before-request', 'pre-request'), post: code('after-response', 'post-response') },
    tests: code('tests')
  }
}

/** Bruno operators Milka names differently: [operator, value]. */
const ASSERT_ALIASES: Record<string, [AssertOperator, string]> = {
  isDefined: ['exists', ''],
  isUndefined: ['notExists', ''],
  isNull: ['eq', 'null'],
  isNumber: ['isType', 'number'],
  isString: ['isType', 'string'],
  isBoolean: ['isType', 'boolean'],
  isArray: ['isType', 'array']
}

function assertions(value: unknown, warn: Warn): Assertion[] {
  return nodes(value).map((row) => {
    const expr = text(row.expression ?? row.expr)
    const operator = text(row.operator ?? row.op)
    const enabled = isEnabled(row)
    const alias = ASSERT_ALIASES[operator]
    if (alias) return { expr, op: alias[0], value: alias[1], enabled }
    if ((ASSERT_OPERATORS as readonly string[]).includes(operator))
      return { expr, op: operator as AssertOperator, value: text(row.value), enabled }
    warn(`assertion "${expr} ${operator}" has no Milka equivalent: kept as an "equals" to fix`)
    return { expr, op: 'eq', value: `${operator} ${text(row.value)}`.trim(), enabled }
  })
}

/** Post-response variables are `set-variable` actions: the value is read from the response. */
function postVars(value: unknown): KeyValue[] {
  return nodes(value)
    .filter((action) => action.type === 'set-variable' && text(node(action.variable).name))
    .map((action) => ({
      name: text(node(action.variable).name),
      value: text(node(action.selector).expression),
      enabled: isEnabled(action),
      description: ''
    }))
}

/** One file path of a multipart field or a file body (Bruno allows a list). */
const filePath = (value: unknown): string => (Array.isArray(value) ? text(value[0]) : text(value))

function body(value: unknown, name: string): Body | null {
  const config = node(value)
  const data = config.data
  switch (config.type) {
    case 'json':
    case 'xml':
    case 'text':
      return newBody(name, config.type, text(data))
    case 'sparql':
      return newBody(name, 'text', text(data))
    case 'graphql':
      return {
        ...newBody(name, 'graphql', typeof data === 'string' ? data : text(node(data).query)),
        variables: text(node(data).variables)
      }
    case 'form-urlencoded':
      return { ...newBody(name, 'form'), fields: keyValues(data).map((field) => ({ ...field, type: 'text' as const })) }
    case 'multipart-form':
      return {
        ...newBody(name, 'multipart'),
        fields: nodes(data)
          .filter((field) => text(field.name))
          .map((field): FormField => ({
            name: text(field.name),
            value: field.type === 'file' ? filePath(field.value ?? field.filePath) : text(field.value),
            enabled: isEnabled(field),
            description: '',
            type: field.type === 'file' ? 'file' : 'text'
          }))
      }
    case 'file': {
      const files = [...nodes(data), ...nodes(config.file)]
      const chosen = files.find((file) => file.selected === true) ?? files[0]
      return newBody(name, 'binary', filePath(chosen?.filePath))
    }
    default:
      return null
  }
}

/** The request body, then the bodies of its saved examples as extra variants. */
function bodies(request: Node, examples: unknown): Body[] {
  const list: Body[] = []
  const add = (value: unknown, name: string): void => {
    const parsed = body(value, name)
    if (!parsed) return
    let unique = parsed.name
    for (let i = 2; list.some((b) => b.name === unique); i++) unique = `${parsed.name} (${i})`
    list.push({ ...parsed, name: unique })
  }
  add(request.body, 'Default')
  for (const example of nodes(examples)) add(node(example.request).body, text(example.name) || 'Example')
  return list
}

function toRequest(doc: Node, fallbackName: string, warn: Warn): HttpRequest {
  const info = node(doc.info)
  const request = node(doc.http ?? doc.graphql)
  const runtime = node(doc.runtime)
  const settings = node(doc.settings)
  const params: Param[] = nodes(request.params)
    .filter((row) => text(row.name))
    .map((row) => ({ ...keyValues([row])[0], type: row.type === 'path' ? 'path' : 'query' }))
  return newRequest(text(info.name) || fallbackName, {
    seq: Number(info.seq) || 0,
    method: (text(request.method) || 'GET').toUpperCase(),
    // Bruno keeps the query string in the URL and in params: Milka only in params.
    url: text(request.url).split('?')[0],
    params,
    headers: keyValues(request.headers),
    auth: auth(request.auth, 'inherit', warn),
    bodies: bodies(request, doc.examples),
    vars: { pre: keyValues(runtime.variables), post: postVars(runtime.actions) },
    ...scripts(runtime.scripts),
    assertions: assertions(runtime.assertions, warn),
    docs: docs(doc.docs),
    tags: Array.isArray(info.tags) ? info.tags.map(text) : [],
    settings: {
      timeout: Number(settings.timeout) || 0,
      followRedirects: settings.followRedirects !== false,
      maxRedirects: settings.maxRedirects === undefined ? 5 : Number(settings.maxRedirects) || 0
    }
  })
}

/** What a folder or the collection passes on to its requests. */
function inherited(doc: Node, authFallback: Auth['type'], warn: Warn) {
  const request = node(doc.request)
  return {
    headers: keyValues(request.headers),
    auth: auth(request.auth, authFallback, warn),
    vars: keyValues(request.variables),
    ...scripts(request.scripts),
    docs: docs(doc.docs)
  }
}

const REQUEST_TYPES = ['http', 'graphql']

function readItems(root: string, dir: string, ignored: string[], warnings: string[]): ImportedItem[] {
  const items: { seq: number; item: ImportedItem }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Hidden folders are skipped (.git…), not hidden files: a request may be named `.well-known`.
    if ((entry.isDirectory() && entry.name.startsWith('.')) || ignored.includes(entry.name)) continue
    const path = join(dir, entry.name)
    const where = relative(root, path)
    const warn: Warn = (message) => warnings.push(`${where}: ${message}`)
    if (entry.isDirectory()) {
      if (dir === root && entry.name === 'environments') continue
      const folderFile = join(path, 'folder.yml')
      const doc = existsSync(folderFile) ? readYaml(folderFile) : {}
      const info = node(doc.info)
      const folder = { ...newFolder(text(info.name) || entry.name), ...inherited(doc, 'inherit', warn) }
      items.push({ seq: Number(info.seq) || 0, item: { kind: 'folder', folder, items: readItems(root, path, ignored, warnings) } })
    } else if (isYaml(entry.name) && !['folder.yml', 'opencollection.yml'].includes(entry.name)) {
      let doc: Node
      try {
        doc = readYaml(path)
      } catch (error) {
        warn(`not valid YAML, skipped (${(error as Error).message.split('\n')[0]})`)
        continue
      }
      const type = text(node(doc.info).type) || (doc.http ? 'http' : '')
      if (!REQUEST_TYPES.includes(type)) {
        if (type) warn(`${type} requests are not supported yet, skipped`)
        continue
      }
      const request = toRequest(doc, basename(entry.name, extname(entry.name)), warn)
      items.push({ seq: request.seq, item: { kind: 'request', request } })
    }
  }
  return items.sort((a, b) => a.seq - b.seq).map((i) => i.item)
}

function readEnvironment(path: string): Environment {
  const doc = readYaml(path)
  const variables = nodes(doc.variables)
  return {
    ...newEnvironment(text(doc.name) || basename(path, extname(path))),
    vars: keyValues(variables.filter((v) => v.secret !== true)),
    // Secret values never leave Bruno's own store: only their names are imported.
    secrets: variables.filter((v) => v.secret === true && text(v.name)).map((v) => text(v.name))
  }
}

/**
 * The name the Bruno workspace gives the collection, when it belongs to one:
 * the collection file itself often keeps a generic name.
 */
function workspaceName(dir: string): string {
  for (let parent = dirname(dir); parent !== dirname(parent); parent = dirname(parent)) {
    const file = join(parent, 'workspace.yml')
    if (!existsSync(file)) continue
    const entry = nodes(readYaml(file).collections).find((c) => resolve(parent, text(c.path)) === resolve(dir))
    return entry ? text(entry.name) : ''
  }
  return ''
}

export function importOpenCollection(dir: string): ImportedCollection {
  const doc = readYaml(join(dir, 'opencollection.yml'))
  const warnings: string[] = []
  const warn: Warn = (message) => warnings.push(`opencollection.yml: ${message}`)
  const ignore = node(node(doc.extensions).bruno).ignore
  const ignored = ['node_modules', ...(Array.isArray(ignore) ? ignore.map(text) : [])]
  const collection = {
    ...newCollection(workspaceName(dir) || text(node(doc.info).name) || basename(dir)),
    ...inherited(doc, 'none', warn)
  }
  const envDir = join(dir, 'environments')
  const environments = existsSync(envDir)
    ? readdirSync(envDir)
        .filter(isYaml)
        .map((file) => readEnvironment(join(envDir, file)))
    : []
  return { collection, environments, items: readItems(dir, dir, ignored, warnings), warnings }
}
