// Exports a collection as an OpenAPI 3.1 document: one operation per request,
// the bodies of a request as named examples, folders as tags.
import { stringify } from 'yaml'
import type { WorkspaceStore } from '../layout/store'
import type { Auth, Body, HttpRequest, TreeNode } from '../model'
import { slugify } from '../slug'
import { enabledVars } from '../vars'

type Json = Record<string, unknown>

interface Located {
  request: HttpRequest
  /** Name of the top-level folder, used as tag. */
  tag: string | null
  /** Auth after inheritance from folders and collection. */
  auth: Auth
}

/** Rough JSON schema of an example value. */
export function inferSchema(value: unknown): Json {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return value.length ? { type: 'array', items: inferSchema(value[0]) } : { type: 'array' }
  switch (typeof value) {
    case 'object':
      return { type: 'object', properties: Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, inferSchema(v)])) }
    case 'number':
      return { type: Number.isInteger(value) ? 'integer' : 'number' }
    case 'boolean':
      return { type: 'boolean' }
    default:
      return { type: 'string' }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const MEDIA_TYPES: Record<Body['type'], string | null> = {
  none: null,
  json: 'application/json',
  graphql: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  form: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
  binary: 'application/octet-stream'
}

function exampleValue(body: Body): unknown {
  switch (body.type) {
    case 'json':
      return parseJson(body.content)
    case 'graphql':
      return { query: body.content, variables: parseJson(body.variables || '{}') }
    case 'form':
    case 'multipart':
      return Object.fromEntries(
        body.fields.filter((f) => f.enabled && f.name).map((f) => [f.name, f.type === 'file' ? '(binary)' : f.value])
      )
    default:
      return body.content
  }
}

function requestBody(bodies: Body[]): Json | undefined {
  const content: Json = {}
  for (const body of bodies) {
    const mediaType = MEDIA_TYPES[body.type]
    if (!mediaType) continue
    const media = (content[mediaType] ??= { examples: {} }) as { schema?: Json; examples: Json }
    const value = exampleValue(body)
    if (!media.schema) {
      if (body.type === 'multipart' || body.type === 'form') {
        media.schema = {
          type: 'object',
          properties: Object.fromEntries(
            body.fields
              .filter((f) => f.name)
              .map((f) => [f.name, f.type === 'file' ? { type: 'string', format: 'binary' } : { type: 'string' }])
          )
        }
      } else if (body.type === 'binary') media.schema = { type: 'string', format: 'binary' }
      else media.schema = typeof value === 'object' ? inferSchema(value) : { type: 'string' }
    }
    media.examples[body.name] = { value }
  }
  return Object.keys(content).length ? { content } : undefined
}

function securityScheme(auth: Auth): { name: string; scheme: Json } | null {
  switch (auth.type) {
    case 'basic':
      return { name: 'basicAuth', scheme: { type: 'http', scheme: 'basic' } }
    case 'bearer':
      return { name: 'bearerAuth', scheme: { type: 'http', scheme: 'bearer' } }
    case 'apikey':
      return {
        name: `apiKey${auth.in === 'query' ? 'Query' : 'Header'}`,
        scheme: { type: 'apiKey', in: auth.in, name: auth.key || 'X-API-Key' }
      }
    default:
      return null
  }
}

function collect(store: WorkspaceStore, slug: string, nodes: TreeNode[], tag: string | null, inherited: Auth, out: Located[]): void {
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const folder = store.readFolder(slug, node.path)
      collect(store, slug, node.children, tag ?? folder.name, folder.auth.type === 'inherit' ? inherited : folder.auth, out)
    } else {
      const request = store.readRequest(slug, node.path)
      out.push({ request, tag, auth: request.auth.type === 'inherit' ? inherited : request.auth })
    }
  }
}

/** Splits `{{baseUrl}}/users/:id` into its server part and an OpenAPI path. */
function splitUrl(url: string): { server: string | null; path: string; pathParams: string[] } {
  let server: string | null = null
  let rest = url
  const leadingVar = /^\{\{\s*([^}\s]+)\s*\}\}/.exec(url)
  if (leadingVar) {
    server = `{{${leadingVar[1]}}}`
    rest = url.slice(leadingVar[0].length)
  } else {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(url)
    if (absolute) {
      server = absolute[0]
      rest = url.slice(absolute[0].length)
    }
  }
  const pathParams: string[] = []
  const path =
    (rest.split('?')[0] || '/')
      .replace(/\/:([A-Za-z_][\w-]*)/g, (_, name: string) => {
        pathParams.push(name)
        return `/{${name}}`
      })
      .replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, name: string) => {
        pathParams.push(name)
        return `{${name}}`
      }) || '/'
  return { server, path: path.startsWith('/') ? path : `/${path}`, pathParams }
}

export function exportOpenApi(store: WorkspaceStore, slug: string): Json {
  const collection = store.readCollection(slug)
  const located: Located[] = []
  collect(store, slug, store.readTree(slug), null, collection.auth, located)

  // Values of the server variables: collection first, then each environment.
  const collectionVars = enabledVars(collection.vars)
  const environments = store
    .listEnvironments(slug)
    .map((e) => ({ name: e.name, vars: enabledVars(store.readEnvironment(slug, e.slug).vars) }))
  const servers: Json[] = []
  const addServer = (server: string): void => {
    const variable = /^\{\{(.+)\}\}$/.exec(server)?.[1]
    const candidates = variable
      ? [
          ...(collectionVars[variable] ? [{ url: collectionVars[variable], description: collection.name }] : []),
          ...environments.filter((e) => e.vars[variable]).map((e) => ({ url: e.vars[variable], description: e.name }))
        ]
      : [{ url: server }]
    for (const candidate of candidates) if (!servers.some((s) => s.url === candidate.url)) servers.push(candidate)
  }

  const paths: Record<string, Json> = {}
  const securitySchemes: Json = {}
  const tags = new Set<string>()
  const operationIds = new Set<string>()
  for (const { request, tag, auth } of located) {
    const { server, path, pathParams } = splitUrl(request.url)
    if (server) addServer(server)
    const method = request.method.toLowerCase()
    const pathItem = (paths[path] ??= {})
    const existing = pathItem[method] as Json | undefined
    const body = requestBody(request.bodies)
    if (existing) {
      // Same endpoint in two requests: their bodies become more examples.
      if (body && existing.requestBody) {
        const content = (existing.requestBody as { content: Record<string, { examples: Json }> }).content
        for (const [mediaType, media] of Object.entries(body.content as Record<string, { examples: Json }>)) {
          if (content[mediaType]) Object.assign(content[mediaType].examples, media.examples)
          else content[mediaType] = media
        }
      }
      continue
    }
    let operationId = slugify(request.name).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
    for (let n = 2; operationIds.has(operationId); n++) operationId = `${operationId.replace(/\d+$/, '')}${n}`
    operationIds.add(operationId)

    const parameters: Json[] = []
    for (const name of new Set(pathParams)) {
      const param = request.params.find((p) => p.type === 'path' && p.name === name)
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
        ...(param?.description ? { description: param.description } : {})
      })
    }
    for (const param of request.params.filter((p) => p.type === 'query' && p.name)) {
      parameters.push({
        name: param.name,
        in: 'query',
        required: param.enabled,
        schema: { type: 'string' },
        ...(param.value && !param.value.includes('{{') ? { example: param.value } : {}),
        ...(param.description ? { description: param.description } : {})
      })
    }
    for (const header of request.headers.filter((h) => h.name && !/^(content-type|authorization|accept)$/i.test(h.name))) {
      parameters.push({ name: header.name, in: 'header', required: header.enabled, schema: { type: 'string' } })
    }

    const statusAssertion = request.assertions.find((a) => a.enabled && a.expr.trim() === 'res.status' && a.op === 'eq')
    const status = statusAssertion ? String(statusAssertion.value) : '200'
    const scheme = securityScheme(auth)
    if (scheme) securitySchemes[scheme.name] = scheme.scheme
    if (tag) tags.add(tag)

    pathItem[method] = {
      operationId,
      summary: request.name,
      ...(request.docs.trim() ? { description: request.docs.trim() } : {}),
      ...(tag ? { tags: [tag] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(body ? { requestBody: body } : {}),
      responses: { [/^\d{3}$/.test(status) ? status : '200']: { description: 'Successful response' } },
      ...(scheme ? { security: [{ [scheme.name]: [] }] } : auth.type === 'none' && collection.auth.type !== 'none' ? { security: [] } : {})
    }
  }

  return {
    openapi: '3.1.0',
    info: { title: collection.name, version: '1.0.0', ...(collection.docs.trim() ? { description: collection.docs.trim() } : {}) },
    ...(servers.length ? { servers } : {}),
    ...(tags.size ? { tags: [...tags].map((name) => ({ name })) } : {}),
    paths,
    ...(Object.keys(securitySchemes).length ? { components: { securitySchemes } } : {})
  }
}

export function openApiText(document: Json, format: 'yaml' | 'json'): string {
  return format === 'json' ? JSON.stringify(document, null, 2) + '\n' : stringify(document, { lineWidth: 0, aliasDuplicateObjects: false })
}
