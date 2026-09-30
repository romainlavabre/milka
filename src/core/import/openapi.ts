// Imports an OpenAPI 3 document (JSON or YAML): one request per operation,
// grouped in folders by tag, named examples of a request body becoming
// several bodies.
import { parse } from 'yaml'
import {
  newBody,
  newCollection,
  newEnvironment,
  newFolder,
  newRequest,
  type Auth,
  type Body,
  type HttpRequest,
  type KeyValue,
  type Param
} from '../model'
import type { ImportedCollection, ImportedItem } from './imported'

type Json = Record<string, unknown>

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resolves local `$ref`s (`#/components/...`), guarding against cycles. */
function resolver(doc: Json) {
  const deref = (value: unknown, seen: Set<string> = new Set()): unknown => {
    if (!isObject(value) || typeof value.$ref !== 'string') return value
    const ref = value.$ref
    if (!ref.startsWith('#/') || seen.has(ref)) return {}
    const target = ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), doc)
    return deref(target, new Set([...seen, ref]))
  }
  return deref
}

/** A plausible example value built from a JSON schema; recursive references stop at `null`. */
function exampleOf(schema: unknown, deref: (v: unknown) => unknown, depth = 0, seen: Set<string> = new Set()): unknown {
  if (isObject(schema) && typeof schema.$ref === 'string') {
    if (seen.has(schema.$ref)) return null
    seen = new Set([...seen, schema.$ref])
  }
  const s = deref(schema)
  if (!isObject(s) || depth > 6) return null
  if (s.example !== undefined) return s.example
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0]
  if (s.default !== undefined) return s.default
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    const list = s[key]
    if (Array.isArray(list) && list.length) {
      if (key === 'allOf') return Object.assign({}, ...list.map((item) => exampleOf(item, deref, depth + 1, seen)).filter(isObject))
      return exampleOf(list[0], deref, depth + 1, seen)
    }
  }
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type
  if (type === 'object' || isObject(s.properties)) {
    const out: Json = {}
    for (const [name, prop] of Object.entries((s.properties as Json | undefined) ?? {})) out[name] = exampleOf(prop, deref, depth + 1, seen)
    return out
  }
  switch (type) {
    case 'array':
      return [exampleOf(s.items, deref, depth + 1, seen)]
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    case 'string':
      if (s.format === 'date-time') return new Date(0).toISOString()
      if (s.format === 'date') return '1970-01-01'
      if (s.format === 'email') return 'user@example.com'
      if (s.format === 'uuid') return '00000000-0000-0000-0000-000000000000'
      return 'string'
    default:
      return null
  }
}

function scalar(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function bodies(requestBody: unknown, deref: (v: unknown) => unknown): Body[] {
  const rb = deref(requestBody)
  if (!isObject(rb) || !isObject(rb.content)) return []
  const [mediaType, media] = Object.entries(rb.content)[0] ?? []
  if (!mediaType || !isObject(media)) return []
  const schema = deref(media.schema)
  if (/json/.test(mediaType)) {
    const examples = isObject(media.examples) ? Object.entries(media.examples) : []
    if (examples.length) {
      return examples.map(([name, example]) => {
        const ex = deref(example)
        const value = isObject(ex) && 'value' in ex ? ex.value : ex
        return newBody(isObject(ex) && typeof ex.summary === 'string' ? ex.summary : name, 'json', JSON.stringify(value, null, 2))
      })
    }
    const example = media.example !== undefined ? media.example : exampleOf(media.schema, deref)
    return [newBody('Default', 'json', JSON.stringify(example, null, 2))]
  }
  if (mediaType === 'application/x-www-form-urlencoded' || mediaType === 'multipart/form-data') {
    const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : {}
    const fields = Object.entries(properties).map(([name, prop]) => {
      const p = deref(prop)
      const isFile = isObject(p) && (p.format === 'binary' || p.format === 'base64')
      return {
        name,
        value: isFile ? '' : scalar(exampleOf(p, deref)),
        enabled: true,
        description: '',
        type: isFile ? ('file' as const) : ('text' as const)
      }
    })
    return [{ ...newBody('Default', mediaType === 'multipart/form-data' ? 'multipart' : 'form'), fields }]
  }
  if (/xml/.test(mediaType)) return [newBody('Default', 'xml', '')]
  if (/octet-stream/.test(mediaType)) return [newBody('Default', 'binary', '')]
  return [newBody('Default', 'text', '')]
}

function securityAuth(doc: Json, requirement: unknown): Auth | null {
  const base: Auth = { type: 'none', username: '', password: '', token: '', key: '', value: '', in: 'header' }
  if (!Array.isArray(requirement)) return null
  if (requirement.length === 0) return base
  const schemes = isObject(doc.components) && isObject(doc.components.securitySchemes) ? doc.components.securitySchemes : {}
  for (const entry of requirement) {
    for (const name of Object.keys(isObject(entry) ? entry : {})) {
      const scheme = schemes[name]
      if (!isObject(scheme)) continue
      if (scheme.type === 'http' && scheme.scheme === 'basic')
        return { ...base, type: 'basic', username: '{{username}}', password: '{{password}}' }
      if (scheme.type === 'http' && scheme.scheme === 'bearer') return { ...base, type: 'bearer', token: '{{token}}' }
      if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') return { ...base, type: 'bearer', token: '{{token}}' }
      if (scheme.type === 'apiKey' && scheme.in !== 'cookie') {
        return {
          ...base,
          type: 'apikey',
          key: String(scheme.name ?? 'X-API-Key'),
          value: '{{apiKey}}',
          in: scheme.in === 'query' ? 'query' : 'header'
        }
      }
    }
  }
  return null
}

export function importOpenApi(source: string): ImportedCollection {
  let doc: unknown
  try {
    doc = source.trim().startsWith('{') ? JSON.parse(source) : parse(source)
  } catch (error) {
    throw new Error(`Cannot read the OpenAPI document: ${(error as Error).message}`, { cause: error })
  }
  if (!isObject(doc)) throw new Error('Not an OpenAPI document')
  if (typeof doc.swagger === 'string') throw new Error('Swagger 2.0 is not supported: convert the document to OpenAPI 3 first')
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3')) throw new Error('Not an OpenAPI 3 document (missing "openapi: 3.x")')
  const deref = resolver(doc)
  const info = isObject(doc.info) ? doc.info : {}
  const servers = Array.isArray(doc.servers) ? doc.servers.filter(isObject) : []
  const baseUrl = typeof servers[0]?.url === 'string' ? servers[0].url.replace(/\/$/, '') : 'http://localhost'
  const warnings: string[] = []

  const folders = new Map<string, ImportedItem & { kind: 'folder' }>()
  const items: ImportedItem[] = []
  for (const [path, pathItem] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    const pathObject = deref(pathItem)
    if (!isObject(pathObject)) continue
    const sharedParameters = Array.isArray(pathObject.parameters) ? pathObject.parameters : []
    for (const method of METHODS) {
      const operation = pathObject[method]
      if (!isObject(operation)) continue
      const parameters = [...sharedParameters, ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        .map((p) => deref(p))
        .filter(isObject)
      const params: Param[] = []
      const headers: KeyValue[] = []
      for (const p of parameters) {
        const value = scalar(p.example ?? exampleOf(p.schema, deref) ?? '')
        const row = {
          name: String(p.name ?? ''),
          value,
          enabled: p.in === 'path' || p.required === true,
          description: String(p.description ?? '')
        }
        if (p.in === 'path') params.push({ ...row, type: 'path' })
        else if (p.in === 'query') params.push({ ...row, type: 'query' })
        else if (p.in === 'header') headers.push(row)
      }
      const requestBodies = bodies(operation.requestBody, deref)
      const auth = securityAuth(doc, operation.security)
      const request: HttpRequest = newRequest(String(operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`), {
        method: method.toUpperCase(),
        url: `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, ':$1')}`,
        params,
        headers,
        bodies: requestBodies,
        activeBody: requestBodies[0]?.name ?? null,
        docs: [operation.description, operation.operationId ? `Operation: \`${String(operation.operationId)}\`` : '']
          .filter(Boolean)
          .join('\n\n'),
        ...(auth ? { auth } : {})
      })
      const tag = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string' ? operation.tags[0] : null
      if (!tag) {
        items.push({ kind: 'request', request })
        continue
      }
      let folder = folders.get(tag)
      if (!folder) {
        const tagInfo = (Array.isArray(doc.tags) ? doc.tags : []).find((t) => isObject(t) && t.name === tag)
        folder = {
          kind: 'folder',
          folder: { ...newFolder(tag), docs: isObject(tagInfo) ? String(tagInfo.description ?? '') : '' },
          items: []
        }
        folders.set(tag, folder)
        items.push(folder)
      }
      folder.items.push({ kind: 'request', request })
    }
  }
  if (items.length === 0) warnings.push('The document has no operation')

  const collectionAuth = securityAuth(doc, doc.security)
  const secretNames = new Set<string>()
  const collect = (auth: Auth | undefined): void => {
    for (const value of [auth?.token, auth?.password, auth?.value]) {
      const match = /^\{\{(\w+)\}\}$/.exec(value ?? '')
      if (match) secretNames.add(match[1])
    }
  }
  collect(collectionAuth ?? undefined)
  const walk = (list: ImportedItem[]): void =>
    list.forEach((item) => (item.kind === 'folder' ? walk(item.items) : collect(item.request.auth)))
  walk(items)

  return {
    collection: {
      ...newCollection(String(info.title || 'OpenAPI')),
      vars: [{ name: 'baseUrl', value: baseUrl, enabled: true, description: 'Server URL' }],
      docs: String(info.description ?? ''),
      ...(collectionAuth ? { auth: collectionAuth } : {})
    },
    environments: servers.map((server, i) => ({
      ...newEnvironment(String(server.description || (i === 0 ? 'Default' : `Server ${i + 1}`))),
      vars: [{ name: 'baseUrl', value: String(server.url ?? '').replace(/\/$/, ''), enabled: true, description: '' }],
      secrets: [...secretNames]
    })),
    items,
    warnings
  }
}
