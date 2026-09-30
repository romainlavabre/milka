// MCP server: lets an AI assistant browse collections, create collections,
// folders and requests (with several bodies) and send requests. Files are
// written in the workspace like the app does; the app shows them live and
// commits them at the next Sync.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { executeRequest } from '../core/engine'
import { environmentValues, secretsFromProcessEnv } from '../core/environment'
import { WorkspaceStore } from '../core/layout/store'
import {
  AUTH_TYPES,
  BODY_TYPES,
  COLLECTION_COLORS,
  HTTP_METHODS,
  newBody,
  newCollection,
  newEnvironment,
  newFolder,
  newRequest,
  requestSchema,
  type HttpRequest,
  type TreeNode
} from '../core/model'
import { knownWorkspaces } from './workspaces'

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

export function createMcpServer(options: McpOptions): McpServer {
  const server = new McpServer(
    { name: 'milka', version: options.version },
    {
      instructions:
        'Milka stores API requests as YAML files in git workspaces. A request can hold several named bodies (payload variants) and the selected one is sent. ' +
        'Use {{variable}} placeholders for URLs, tokens and ids (e.g. {{baseUrl}}/users/:id). Changes are committed by the next Sync in the Milka app.'
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

  const requestFields = {
    method: z.enum(HTTP_METHODS).optional(),
    url: z.string().optional().describe('e.g. {{baseUrl}}/users/:id — query parameters go in params'),
    params: z
      .array(
        z.object({ name: z.string(), value: z.string(), type: z.enum(['query', 'path']).default('query'), enabled: z.boolean().optional() })
      )
      .optional(),
    headers: keyValues,
    auth: z
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
      .describe('Use {{variables}} for credentials; "inherit" takes the auth of the folder or collection'),
    bodies: z.array(bodyInput).optional().describe('Payload variants; the first one is selected'),
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
    headers?: { name: string; value: string; enabled?: boolean }[]
    auth?: Record<string, unknown>
    bodies?: { name: string; type: string; content: string; fields?: { name: string; value: string; enabled?: boolean }[] }[]
    assertions?: { expr: string; op: string; value?: unknown }[]
    tests?: string
    docs?: string
    tags?: string[]
  }

  /** Applies the given fields on a request, validated by the model schema. */
  const apply = (base: HttpRequest, fields: RequestFields): HttpRequest => {
    const patch: Record<string, unknown> = { ...fields }
    if (fields.bodies) {
      patch.bodies = fields.bodies.map((b) => ({ ...newBody(b.name, b.type as never, b.content), fields: b.fields ?? [] }))
      patch.activeBody = fields.bodies[0]?.name ?? null
    }
    if (fields.auth) patch.auth = { ...base.auth, ...fields.auth }
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
        'Changes fields of a request; the fields given replace the current ones (bodies replaces every body). Renaming renames the file.',
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
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        return { path: store.writeRequest(collection, parent, path, updated).id }
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
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        store.writeRequest(collection, parent, path, updated)
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
