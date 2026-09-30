// MCP server: lets an AI assistant browse, import, create, change, move and
// delete collections, folders, requests (with several bodies) and
// environments, and send requests. Files are written in the workspace like the app does; the
// app shows them live and commits them at the next Sync.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Cookies } from '../core/cookies'
import { executeRequest } from '../core/engine'
import { environmentValues, secretsFromProcessEnv } from '../core/environment'
import { importBruno } from '../core/import/bruno'
import { importCurl } from '../core/import/curl'
import { writeImported } from '../core/import/imported'
import { importOpenApi } from '../core/import/openapi'
import { importPostman } from '../core/import/postman'
import { WorkspaceStore } from '../core/layout/store'
import {
  AUTH_TYPES,
  BODY_TYPES,
  COLLECTION_COLORS,
  HTTP_METHODS,
  collectionSchema,
  folderSchema,
  newBody,
  newCollection,
  newEnvironment,
  newFolder,
  newRequest,
  requestSchema,
  type Auth,
  type HttpRequest,
  type KeyValue,
  type Scripts,
  type TreeNode
} from '../core/model'
import { slugify } from '../core/slug'
import { knownWorkspaces } from './workspaces'

const IMPORT_FORMATS = ['bruno', 'postman', 'openapi', 'curl'] as const

export interface McpOptions {
  /** Fixed workspace folder (--workspace); otherwise the workspaces of the app. */
  workspace?: string
  env: Record<string, string | undefined>
  version: string
  /** Local secret values of an environment, when the app's secret store is reachable. */
  secrets?(workspacePath: string, collection: string, env: string): Record<string, string>
}

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean }

const MAX_BODY_CHARS = 20_000

function ok(value: unknown): Result {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function failure(error: unknown): Result {
  return { content: [{ type: 'text', text: (error as Error)?.message ?? String(error) }], isError: true }
}

function tool<A>(handler: (args: A) => unknown | Promise<unknown>): (args: A) => Promise<Result> {
  return async (args) => {
    try {
      return ok(await handler(args))
    } catch (error) {
      return failure(error)
    }
  }
}

function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'folder'
      ? [`${'  '.repeat(depth)}📁 ${node.name}  (${node.path})`, ...outline(node.children, depth + 1)]
      : [`${'  '.repeat(depth)}${node.method} ${node.name}  (${node.path})`]
  )
}

const workspaceArg = z.string().optional().describe('Workspace name; the active workspace of Milka when omitted')
const collectionArg = z.string().describe('Collection slug (its folder name), as returned by list_collections')
const keyValues = z.array(z.object({ name: z.string(), value: z.string(), enabled: z.boolean().optional() })).optional()
const bodyInput = z.object({
  name: z.string().describe('Name of this payload variant, e.g. "Valid user" or "Missing email"'),
  type: z.enum(BODY_TYPES).default('json'),
  content: z.string().default('').describe('Body text (JSON, XML, text, GraphQL query); file path for "binary"'),
  fields: keyValues.describe('Fields of "form" and "multipart" bodies')
})
const authInput = z
  .object({
    type: z.enum(AUTH_TYPES),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    key: z.string().optional(),
    value: z.string().optional(),
    in: z.enum(['header', 'query']).optional()
  })
  .optional()
  .describe('Use {{variables}} for credentials; "inherit" takes the auth of the folder or collection')
const scriptsInput = z
  .object({
    pre: z.string().optional().describe('TypeScript run before the request, e.g. req.setHeader(...)'),
    post: z.string().optional().describe('TypeScript run after the response, e.g. milka.vars.set("id", res.body.id)')
  })
  .optional()
  .describe('Scripts given replace the current ones; one left out is kept')

type Rows = { name: string; value: string; enabled?: boolean }[]
type AuthFields = Partial<Auth> & { type: Auth['type'] }

const toKeyValues = (rows: Rows): KeyValue[] =>
  rows.map((row) => ({ name: row.name, value: row.value, enabled: row.enabled ?? true, description: '' }))

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** What folders and collections pass on to their requests. */
const inheritedFields = {
  headers: keyValues.describe('Headers added to every request inside'),
  auth: authInput,
  variables: keyValues.describe('Variables of the requests inside'),
  scripts: scriptsInput,
  tests: z.string().optional().describe('TypeScript tests run after every request inside'),
  docs: z.string().optional()
}

type InheritedFields = {
  headers?: Rows
  auth?: AuthFields
  variables?: Rows
  scripts?: Partial<Scripts>
  tests?: string
  docs?: string
}

/** Applies the given fields on a folder or a collection; the others are kept. */
function applyInherited<T extends { headers: KeyValue[]; auth: Auth; vars: KeyValue[]; scripts: Scripts; tests: string; docs: string }>(
  base: T,
  fields: InheritedFields
): T {
  return {
    ...base,
    ...(fields.headers && { headers: toKeyValues(fields.headers) }),
    ...(fields.auth && { auth: { ...base.auth, ...fields.auth } }),
    ...(fields.variables && { vars: toKeyValues(fields.variables) }),
    ...(fields.scripts && { scripts: { ...base.scripts, ...fields.scripts } }),
    ...(fields.tests !== undefined && { tests: fields.tests }),
    ...(fields.docs !== undefined && { docs: fields.docs })
  }
}

/** The local secret values follow a renamed collection or environment in the app only. */
const RENAME_WITH_SECRETS =
  'has secret variables: rename it in the Milka app, which moves the secret values saved on each machine along with it'

export function createMcpServer(options: McpOptions): McpServer {
  // Cookies received by run_request are sent by the next ones, as in the app, until the session ends.
  const cookies = new Cookies()
  const server = new McpServer(
    { name: 'milka', version: options.version },
    {
      instructions:
        'Milka stores API requests as YAML files in git workspaces. A request can hold several named bodies (payload variants) and the selected one is sent. ' +
        'Use {{variable}} placeholders for URLs, tokens and ids (e.g. {{baseUrl}}/users/:id). Folders and collections pass their headers, auth, ' +
        'variables and scripts on to the requests inside. Secret values are never readable nor writable here: declare the name, each user types ' +
        'the value in Milka. Changes are committed by the next Sync in the Milka app, so a deletion can be undone from git.'
    }
  )

  const workspaceOf = (name: string | undefined): WorkspaceStore => {
    const workspaces = knownWorkspaces(options.workspace, options.env)
    if (workspaces.length === 0) throw new Error('No Milka workspace: create one in the app, or start the server with --workspace <folder>')
    const found = name ? workspaces.find((w) => w.name === name || w.path === name) : (workspaces.find((w) => w.active) ?? workspaces[0])
    if (!found) throw new Error(`Unknown workspace "${name}". Known: ${workspaces.map((w) => w.name).join(', ')}`)
    return new WorkspaceStore(found.path)
  }

  server.registerTool(
    'list_workspaces',
    { title: 'List workspaces', description: 'Workspaces (git repositories) known to Milka, with the active one.', inputSchema: {} },
    tool(() => knownWorkspaces(options.workspace, options.env).map(({ name, path, active }) => ({ name, path, active })))
  )

  server.registerTool(
    'list_collections',
    {
      title: 'List collections',
      description: 'Collections of a workspace, with their slug, color and number of requests.',
      inputSchema: { workspace: workspaceArg }
    },
    tool(({ workspace }: { workspace?: string }) => {
      const store = workspaceOf(workspace)
      return store
        .listCollections()
        .map((c) => ({ slug: c.slug, name: c.name, color: c.color, requests: store.listRequests(c.slug).length }))
    })
  )

  server.registerTool(
    'get_collection_tree',
    {
      title: 'Get collection tree',
      description: 'Folders and requests of a collection, with their paths (used by the other tools) and the environments.',
      inputSchema: { workspace: workspaceArg, collection: collectionArg }
    },
    tool(({ workspace, collection }: { workspace?: string; collection: string }) => {
      const store = workspaceOf(workspace)
      const info = store.readCollection(collection)
      const environments = store.listEnvironments(collection).map((e) => e.name)
      return [
        `${info.name} (${collection})`,
        `Variables: ${info.vars.map((v) => v.name).join(', ') || 'none'}`,
        `Environments: ${environments.join(', ') || 'none'}`,
        '',
        ...outline(store.readTree(collection))
      ].join('\n')
    })
  )

  server.registerTool(
    'get_request',
    {
      title: 'Get request',
      description: 'Full definition of a request: URL, params, headers, auth, bodies, scripts and assertions.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        path: z.string().describe('Request path, e.g. users/create-user.yaml')
      }
    },
    tool(({ workspace, collection, path }: { workspace?: string; collection: string; path: string }) =>
      workspaceOf(workspace).readRequest(collection, path)
    )
  )

  server.registerTool(
    'create_collection',
    {
      title: 'Create collection',
      description: 'Creates a collection. Give baseUrl to define a {{baseUrl}} collection variable used by its requests.',
      inputSchema: {
        workspace: workspaceArg,
        name: z.string(),
        color: z
          .string()
          .optional()
          .describe(`Hex color, one of ${COLLECTION_COLORS.join(', ')}`),
        baseUrl: z.string().optional(),
        docs: z.string().optional()
      }
    },
    tool(
      ({
        workspace,
        name,
        color,
        baseUrl,
        docs
      }: {
        workspace?: string
        name: string
        color?: string
        baseUrl?: string
        docs?: string
      }) => {
        const collection = {
          ...newCollection(name, color),
          docs: docs ?? '',
          vars: baseUrl ? [{ name: 'baseUrl', value: baseUrl, enabled: true, description: '' }] : []
        }
        const { id } = workspaceOf(workspace).writeCollection(null, collection)
        return { collection: id }
      }
    )
  )

  server.registerTool(
    'import_collection',
    {
      title: 'Import collection',
      description:
        'Imports a Bruno collection (folder with bruno.json or opencollection.yml), a Postman collection v2.1 or an OpenAPI 3 ' +
        'document as a new collection; or creates a request from a cURL command in an existing collection. Give the source as ' +
        'a path, or its content as text. Secret values are never imported: only the names of secret variables.',
      inputSchema: {
        workspace: workspaceArg,
        format: z.enum(IMPORT_FORMATS),
        path: z.string().optional().describe('Absolute path of the Bruno folder, or of the Postman / OpenAPI file'),
        text: z.string().optional().describe('Postman JSON, OpenAPI YAML or JSON, or the cURL command, instead of a path'),
        collection: z.string().optional().describe('cURL only: collection slug to add the request to'),
        parent: z.string().default('').describe('cURL only: folder path in the collection, empty for its root'),
        name: z.string().optional().describe('cURL only: name of the request, e.g. "Create user"')
      }
    },
    tool(
      ({
        workspace,
        format,
        path,
        text,
        collection,
        parent,
        name
      }: {
        workspace?: string
        format: (typeof IMPORT_FORMATS)[number]
        path?: string
        text?: string
        collection?: string
        parent: string
        name?: string
      }) => {
        const store = workspaceOf(workspace)
        if (format === 'curl') {
          if (!text) throw new Error('Give the cURL command as text')
          if (!collection) throw new Error('Give the collection to add the request to')
          const request = importCurl(text)
          const written = store.writeRequest(collection, parent, null, name ? { ...request, name } : request)
          return { collection, path: written.id }
        }
        if (format === 'bruno') {
          if (!path) throw new Error('Give the path of the Bruno collection folder')
          const result = writeImported(store, importBruno(resolve(path)))
          return { collection: result.slug, requests: result.requests, warnings: result.warnings }
        }
        if (!path && !text) throw new Error(`Give the ${format === 'postman' ? 'Postman' : 'OpenAPI'} document as a path or as text`)
        const source = text ?? readFileSync(resolve(path!), 'utf8')
        const result = writeImported(store, format === 'postman' ? importPostman(source) : importOpenApi(source))
        return { collection: result.slug, requests: result.requests, warnings: result.warnings }
      }
    )
  )

  server.registerTool(
    'create_folder',
    {
      title: 'Create folder',
      description: 'Creates a folder in a collection, or inside another folder.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        parent: z.string().default('').describe('Parent folder path, empty for the collection root'),
        name: z.string()
      }
    },
    tool(({ workspace, collection, parent, name }: { workspace?: string; collection: string; parent: string; name: string }) => ({
      path: workspaceOf(workspace).writeFolder(collection, parent, null, newFolder(name)).id
    }))
  )

  server.registerTool(
    'get_collection',
    {
      title: 'Get collection',
      description: 'Settings of a collection: color, and the headers, auth, variables, scripts and tests its requests inherit.',
      inputSchema: { workspace: workspaceArg, collection: collectionArg }
    },
    tool(({ workspace, collection }: { workspace?: string; collection: string }) => workspaceOf(workspace).readCollection(collection))
  )

  server.registerTool(
    'update_collection',
    {
      title: 'Update collection',
      description:
        'Changes settings of a collection; the fields given replace the current ones (headers replaces every header). Renaming renames its folder.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        name: z.string().optional(),
        color: z
          .string()
          .optional()
          .describe(`Hex color, one of ${COLLECTION_COLORS.join(', ')}`),
        ...inheritedFields
      }
    },
    tool(
      ({
        workspace,
        collection,
        name,
        color,
        ...fields
      }: { workspace?: string; collection: string; name?: string; color?: string } & InheritedFields) => {
        const store = workspaceOf(workspace)
        const current = store.readCollection(collection)
        if (name !== undefined && slugify(name) !== slugify(current.name) && slugify(name) !== collection) {
          const withSecrets = store.listEnvironments(collection).some((e) => store.readEnvironment(collection, e.slug).secrets.length > 0)
          if (withSecrets) throw new Error(`The collection "${current.name}" ${RENAME_WITH_SECRETS}`)
        }
        if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`Invalid color "${color}": expected #rrggbb`)
        const updated = collectionSchema.parse(
          applyInherited({ ...current, name: name ?? current.name, color: color ?? current.color }, fields)
        )
        return { collection: store.writeCollection(collection, updated).id }
      }
    )
  )

  server.registerTool(
    'get_folder',
    {
      title: 'Get folder',
      description: 'Settings of a folder: the headers, auth, variables, scripts and tests its requests inherit.',
      inputSchema: { workspace: workspaceArg, collection: collectionArg, path: z.string().describe('Folder path, e.g. users/admin') }
    },
    tool(({ workspace, collection, path }: { workspace?: string; collection: string; path: string }) =>
      workspaceOf(workspace).readFolder(collection, path)
    )
  )

  server.registerTool(
    'update_folder',
    {
      title: 'Update folder',
      description:
        'Changes settings of a folder; the fields given replace the current ones (headers replaces every header). Renaming renames it.',
      inputSchema: { workspace: workspaceArg, collection: collectionArg, path: z.string(), name: z.string().optional(), ...inheritedFields }
    },
    tool(
      ({
        workspace,
        collection,
        path,
        name,
        ...fields
      }: { workspace?: string; collection: string; path: string; name?: string } & InheritedFields) => {
        const store = workspaceOf(workspace)
        const current = store.readFolder(collection, path)
        const updated = folderSchema.parse(applyInherited({ ...current, name: name ?? current.name }, fields))
        return { path: store.writeFolder(collection, parentOf(path), path, updated).id }
      }
    )
  )

  server.registerTool(
    'move_item',
    {
      title: 'Move request or folder',
      description: 'Moves a request or a folder into another folder of the same collection, or reorders it among its siblings.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        path: z.string().describe('Request file or folder to move'),
        parent: z.string().default('').describe('Destination folder path, empty for the collection root'),
        before: z.string().optional().describe('Path of the sibling to place it before; at the end when omitted')
      }
    },
    tool(
      ({
        workspace,
        collection,
        path,
        parent,
        before
      }: {
        workspace?: string
        collection: string
        path: string
        parent: string
        before?: string
      }) => ({ path: workspaceOf(workspace).move(collection, path, parent, before ?? null).id })
    )
  )

  server.registerTool(
    'delete_item',
    {
      title: 'Delete request or folder',
      description: 'Deletes a request, or a folder with everything inside. It stays in the git history of the workspace.',
      inputSchema: { workspace: workspaceArg, collection: collectionArg, path: z.string().describe('Request file or folder path') }
    },
    tool(({ workspace, collection, path }: { workspace?: string; collection: string; path: string }) => {
      const store = workspaceOf(workspace)
      if (path.endsWith('.yaml')) store.removeRequest(collection, path)
      else store.removeFolder(collection, path)
      return { deleted: path }
    })
  )

  const requestFields = {
    method: z.enum(HTTP_METHODS).optional(),
    url: z.string().optional().describe('e.g. {{baseUrl}}/users/:id — query parameters go in params'),
    params: z
      .array(
        z.object({ name: z.string(), value: z.string(), type: z.enum(['query', 'path']).default('query'), enabled: z.boolean().optional() })
      )
      .optional(),
    headers: keyValues,
    auth: authInput,
    bodies: z.array(bodyInput).optional().describe('Payload variants; the first one is selected'),
    activeBody: z.string().optional().describe('Name of the body to send'),
    variables: z
      .object({
        pre: keyValues.describe('Set before the request; values may use other {{variables}}'),
        post: keyValues.describe('Set from the response: the value is an expression such as res.body.id')
      })
      .optional()
      .describe('Request variables; a list given replaces the current one'),
    scripts: scriptsInput,
    settings: z
      .object({
        timeout: z.number().int().min(0).optional().describe('Milliseconds, 0 for the default'),
        followRedirects: z.boolean().optional(),
        maxRedirects: z.number().int().min(0).optional()
      })
      .optional(),
    assertions: z
      .array(
        z.object({ expr: z.string().describe('e.g. res.status, res.body.id'), op: z.string().default('eq'), value: z.unknown().optional() })
      )
      .optional(),
    tests: z.string().optional().describe("TypeScript tests, e.g. test('created', () => expect(res.status).toBe(201))"),
    docs: z.string().optional(),
    tags: z.array(z.string()).optional()
  }

  type RequestFields = {
    method?: string
    url?: string
    params?: { name: string; value: string; type: 'query' | 'path'; enabled?: boolean }[]
    headers?: Rows
    auth?: AuthFields
    bodies?: { name: string; type: string; content: string; fields?: Rows }[]
    activeBody?: string
    variables?: { pre?: Rows; post?: Rows }
    scripts?: Partial<Scripts>
    settings?: Partial<HttpRequest['settings']>
    assertions?: { expr: string; op: string; value?: unknown }[]
    tests?: string
    docs?: string
    tags?: string[]
  }

  /** Applies the given fields on a request, validated by the model schema. */
  const apply = (base: HttpRequest, fields: RequestFields): HttpRequest => {
    const { variables, activeBody, ...rest } = fields
    const patch: Record<string, unknown> = { ...rest }
    if (fields.bodies) {
      patch.bodies = fields.bodies.map((b) => ({ ...newBody(b.name, b.type as never, b.content), fields: b.fields ?? [] }))
      patch.activeBody = fields.bodies[0]?.name ?? null
    }
    if (activeBody !== undefined) {
      const names = ((patch.bodies as HttpRequest['bodies'] | undefined) ?? base.bodies).map((b) => b.name)
      if (!names.includes(activeBody)) throw new Error(`No body named "${activeBody}". Bodies: ${names.join(', ') || 'none'}`)
      patch.activeBody = activeBody
    }
    if (fields.auth) patch.auth = { ...base.auth, ...fields.auth }
    if (variables)
      patch.vars = {
        pre: variables.pre ? toKeyValues(variables.pre) : base.vars.pre,
        post: variables.post ? toKeyValues(variables.post) : base.vars.post
      }
    if (fields.scripts) patch.scripts = { ...base.scripts, ...fields.scripts }
    if (fields.settings) patch.settings = { ...base.settings, ...fields.settings }
    return requestSchema.parse({ ...base, ...patch })
  }

  server.registerTool(
    'create_request',
    {
      title: 'Create request',
      description:
        'Creates a request. Put the variants of the payload (valid, missing field, edge case…) as several bodies of the same request rather than several requests.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        parent: z.string().default('').describe('Folder path, empty for the collection root'),
        name: z.string(),
        ...requestFields
      }
    },
    tool(
      ({
        workspace,
        collection,
        parent,
        name,
        ...fields
      }: { workspace?: string; collection: string; parent: string; name: string } & RequestFields) => {
        const request = apply(newRequest(name), fields)
        return { path: workspaceOf(workspace).writeRequest(collection, parent, null, request).id }
      }
    )
  )

  server.registerTool(
    'update_request',
    {
      title: 'Update request',
      description:
        'Changes fields of a request; the fields given replace the current ones (bodies replaces every body, a script left out is kept). ' +
        'Renaming renames the file; move_item moves it to another folder.',
      inputSchema: { workspace: workspaceArg, collection: collectionArg, path: z.string(), name: z.string().optional(), ...requestFields }
    },
    tool(
      ({
        workspace,
        collection,
        path,
        name,
        ...fields
      }: { workspace?: string; collection: string; path: string; name?: string } & RequestFields) => {
        const store = workspaceOf(workspace)
        const current = store.readRequest(collection, path)
        const updated = apply({ ...current, name: name ?? current.name }, fields)
        return { path: store.writeRequest(collection, parentOf(path), path, updated).id }
      }
    )
  )

  server.registerTool(
    'add_body',
    {
      title: 'Add body',
      description: 'Adds a payload variant to a request, keeping its other bodies.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        path: z.string(),
        select: z.boolean().default(false).describe('Make it the body sent'),
        ...bodyInput.shape
      }
    },
    tool(
      ({
        workspace,
        collection,
        path,
        select,
        ...body
      }: {
        workspace?: string
        collection: string
        path: string
        select: boolean
        name: string
        type: string
        content: string
        fields?: { name: string; value: string; enabled?: boolean }[]
      }) => {
        const store = workspaceOf(workspace)
        const request = store.readRequest(collection, path)
        if (request.bodies.some((b) => b.name === body.name)) throw new Error(`The request already has a body named "${body.name}"`)
        const created = {
          ...newBody(body.name, body.type as never, body.content),
          fields: (body.fields ?? []).map((f) => ({ ...f, enabled: f.enabled ?? true, description: '', type: 'text' as const }))
        }
        // A lone body is not marked as selected in the file: keep sending the one that was sent.
        const current = request.activeBody ?? request.bodies[0]?.name ?? null
        const updated = { ...request, bodies: [...request.bodies, created], activeBody: select || !current ? created.name : current }
        store.writeRequest(collection, parentOf(path), path, updated)
        return { bodies: updated.bodies.map((b) => b.name), selected: updated.activeBody }
      }
    )
  )

  server.registerTool(
    'list_environments',
    {
      title: 'List environments',
      description: 'Environments of a collection with their variable names. Secret values are never returned.',
      inputSchema: { workspace: workspaceArg, collection: collectionArg }
    },
    tool(({ workspace, collection }: { workspace?: string; collection: string }) => {
      const store = workspaceOf(workspace)
      return store.listEnvironments(collection).map((e) => {
        const env = store.readEnvironment(collection, e.slug)
        return { slug: e.slug, name: env.name, variables: env.vars.map((v) => ({ name: v.name, value: v.value })), secrets: env.secrets }
      })
    })
  )

  server.registerTool(
    'create_environment',
    {
      title: 'Create environment',
      description: 'Creates an environment. Secret variables are listed by name only: each user types their value in Milka.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        name: z.string(),
        variables: keyValues,
        secrets: z.array(z.string()).optional()
      }
    },
    tool(
      ({
        workspace,
        collection,
        name,
        variables,
        secrets
      }: {
        workspace?: string
        collection: string
        name: string
        variables?: { name: string; value: string; enabled?: boolean }[]
        secrets?: string[]
      }) => {
        const environment = {
          ...newEnvironment(name),
          vars: (variables ?? []).map((v) => ({ ...v, enabled: v.enabled ?? true, description: '' })),
          secrets: secrets ?? []
        }
        return { environment: workspaceOf(workspace).writeEnvironment(collection, null, environment).id }
      }
    )
  )

  server.registerTool(
    'update_environment',
    {
      title: 'Update environment',
      description:
        'Adds, changes or removes variables of an environment, or declares secret ones. The other variables are kept. ' +
        'Secret values stay out of reach: each user types them in Milka.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        environment: z.string().describe('Environment name or slug'),
        name: z.string().optional().describe('New name of the environment'),
        set: keyValues.describe('Shared variables to add or change; their values are committed'),
        secrets: z
          .array(z.string())
          .optional()
          .describe('Names to declare secret; a shared variable of that name loses its committed value'),
        remove: z.array(z.string()).optional().describe('Variables or secrets to remove')
      }
    },
    tool(
      ({
        workspace,
        collection,
        environment,
        name,
        set,
        secrets: declared,
        remove
      }: {
        workspace?: string
        collection: string
        environment: string
        name?: string
        set?: Rows
        secrets?: string[]
        remove?: string[]
      }) => {
        const store = workspaceOf(workspace)
        const slug = store.findEnvironment(collection, environment)
        const current = store.readEnvironment(collection, slug)
        let vars = [...current.vars]
        let secrets = [...current.secrets]
        for (const variable of remove ?? []) {
          if (!vars.some((v) => v.name === variable) && !secrets.includes(variable))
            throw new Error(`The environment "${current.name}" has no variable "${variable}"`)
          vars = vars.filter((v) => v.name !== variable)
          secrets = secrets.filter((s) => s !== variable)
        }
        for (const row of set ?? []) {
          if (secrets.includes(row.name))
            throw new Error(`"${row.name}" is a secret: its value is typed by each user in Milka, never written in the workspace`)
          const index = vars.findIndex((v) => v.name === row.name)
          const previous = index === -1 ? null : vars[index]
          const next = {
            name: row.name,
            value: row.value,
            enabled: row.enabled ?? previous?.enabled ?? true,
            description: previous?.description ?? ''
          }
          if (index === -1) vars.push(next)
          else vars[index] = next
        }
        for (const secret of declared ?? []) {
          vars = vars.filter((v) => v.name !== secret)
          if (!secrets.includes(secret)) secrets.push(secret)
        }
        if (name !== undefined && slugify(name) !== slugify(current.name) && slugify(name) !== slug && current.secrets.length > 0)
          throw new Error(`The environment "${current.name}" ${RENAME_WITH_SECRETS}`)
        const written = store.writeEnvironment(collection, slug, { ...current, name: name ?? current.name, vars, secrets })
        return { environment: written.id, variables: vars.map((v) => ({ name: v.name, value: v.value })), secrets }
      }
    )
  )

  server.registerTool(
    'run_request',
    {
      title: 'Run request',
      description: 'Sends a request with an environment and returns the response, assertions and test results.',
      inputSchema: {
        workspace: workspaceArg,
        collection: collectionArg,
        path: z.string(),
        environment: z.string().optional().describe('Environment name or slug'),
        body: z.string().optional().describe('Body variant to send instead of the selected one')
      }
    },
    tool(
      async ({
        workspace,
        collection,
        path,
        environment,
        body
      }: {
        workspace?: string
        collection: string
        path: string
        environment?: string
        body?: string
      }) => {
        const store = workspaceOf(workspace)
        const env = environment ? store.findEnvironment(collection, environment) : null
        const names = env ? store.readEnvironment(collection, env).secrets : []
        const secrets = {
          ...secretsFromProcessEnv(names, options.env),
          ...(env && options.secrets ? options.secrets(store.root, collection, env) : {})
        }
        const result = await executeRequest({
          store,
          collection,
          path,
          bodyName: body ?? null,
          environment: environmentValues(store, collection, env, secrets),
          runtime: {},
          cookies,
          processEnv: options.env
        })
        const response = result.response
        return {
          request: result.request && { method: result.request.method, url: result.request.url, body: result.request.bodyName },
          error: result.error,
          skipped: result.skipped,
          response: response && {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            timeMs: Math.round(response.timings.total),
            body:
              response.encoding === 'utf8'
                ? response.body.length > MAX_BODY_CHARS
                  ? `${response.body.slice(0, MAX_BODY_CHARS)}… (truncated)`
                  : response.body
                : `<${response.size} bytes of binary>`
          },
          tests: result.tests,
          logs: result.logs
        }
      }
    )
  )

  return server
}
