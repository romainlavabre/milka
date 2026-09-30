// Conversion of model objects to the plain objects written in YAML files:
// fixed key order, and only the fields that matter for the chosen types.
import type { Auth, AuthType, Body, Collection, Environment, Folder, HttpRequest, RequestSettings } from '../model'
import { prune } from './yaml'

function auth(value: Auth, fallback: AuthType): unknown {
  switch (value.type) {
    case 'basic':
      return { type: 'basic', username: value.username, password: value.password }
    case 'bearer':
      return { type: 'bearer', token: value.token }
    case 'apikey':
      return { type: 'apikey', key: value.key, value: value.value, in: value.in }
    default:
      return value.type === fallback ? undefined : { type: value.type }
  }
}

function body(value: Body): unknown {
  return {
    name: value.name,
    type: value.type,
    content: value.type === 'form' || value.type === 'multipart' || value.type === 'none' ? undefined : value.content,
    variables: value.type === 'graphql' ? value.variables : undefined,
    fields: value.type === 'form' || value.type === 'multipart' ? value.fields.map((f) => ({ ...f, type: f.type === 'text' ? undefined : f.type })) : undefined
  }
}

function settings(value: RequestSettings): unknown {
  return {
    timeout: value.timeout || undefined,
    followRedirects: value.followRedirects ? undefined : false,
    maxRedirects: value.maxRedirects === 5 ? undefined : value.maxRedirects
  }
}

export function requestToFile(request: HttpRequest): unknown {
  return prune({
    name: request.name,
    seq: request.seq,
    method: request.method,
    url: request.url,
    tags: request.tags,
    params: request.params.map((p) => ({ ...p, type: p.type === 'query' ? undefined : p.type })),
    headers: request.headers,
    auth: auth(request.auth, 'inherit'),
    bodies: request.bodies.map(body),
    activeBody: request.bodies.length > 1 ? request.activeBody : undefined,
    vars: request.vars,
    scripts: request.scripts,
    assertions: request.assertions,
    tests: request.tests,
    docs: request.docs,
    settings: settings(request.settings)
  })
}

export function folderToFile(folder: Folder): unknown {
  return prune({
    name: folder.name,
    seq: folder.seq,
    headers: folder.headers,
    auth: auth(folder.auth, 'inherit'),
    vars: folder.vars,
    scripts: folder.scripts,
    tests: folder.tests,
    docs: folder.docs
  })
}

export function collectionToFile(collection: Collection): unknown {
  return prune({
    name: collection.name,
    color: collection.color,
    headers: collection.headers,
    auth: auth(collection.auth, 'none'),
    vars: collection.vars,
    scripts: collection.scripts,
    tests: collection.tests,
    docs: collection.docs
  })
}

export function environmentToFile(environment: Environment): unknown {
  return prune({ name: environment.name, vars: environment.vars, secrets: environment.secrets })
}
