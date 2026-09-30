// Data model of a workspace: collections, folders, requests and environments.
//
// Every schema is lenient: a missing or invalid field falls back to its
// default instead of rejecting the whole file, so a hand-edited or newer file
// never makes a request disappear.
import { z } from 'zod'

const text = (fallback = '') => z.string().default(fallback).catch(fallback)
const bool = (fallback: boolean) => z.boolean().default(fallback).catch(fallback)
const int = (fallback: number) => z.number().int().default(fallback).catch(fallback)
const list = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((items) => items.flatMap((raw) => (item.safeParse(raw).success ? [item.parse(raw) as z.output<T>] : [])))

/** Anything written in YAML (number, boolean…) is read back as text. */
const scalarText = z
  .unknown()
  .transform((value) => (value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)))

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const keyValueSchema = z.object({
  name: z.string(),
  value: scalarText,
  enabled: bool(true),
  description: text()
})
export type KeyValue = z.output<typeof keyValueSchema>

export const paramSchema = keyValueSchema.extend({
  /** Query string parameter, or `:name` path segment of the URL. */
  type: z.enum(['query', 'path']).default('query').catch('query')
})
export type Param = z.output<typeof paramSchema>

export const formFieldSchema = keyValueSchema.extend({
  /** For multipart bodies: `file` sends the file at path `value`. */
  type: z.enum(['text', 'file']).default('text').catch('text')
})
export type FormField = z.output<typeof formFieldSchema>

export const BODY_TYPES = ['none', 'json', 'xml', 'text', 'form', 'multipart', 'graphql', 'binary'] as const
export type BodyType = (typeof BODY_TYPES)[number]

export const bodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(BODY_TYPES).default('json').catch('json'),
  /** JSON, XML, text or GraphQL query; file path for a binary body. */
  content: scalarText.default(''),
  /** GraphQL variables, as JSON. */
  variables: text(),
  /** Fields of form and multipart bodies. */
  fields: list(formFieldSchema)
})
export type Body = z.output<typeof bodySchema>

export const AUTH_TYPES = ['inherit', 'none', 'basic', 'bearer', 'apikey'] as const
export type AuthType = (typeof AUTH_TYPES)[number]

const authSchema = (fallback: AuthType) =>
  z
    .object({
      type: z.enum(AUTH_TYPES).default(fallback).catch(fallback),
      username: text(),
      password: text(),
      token: text(),
      key: text(),
      value: text(),
      in: z.enum(['header', 'query']).default('header').catch('header')
    })
    .default({ type: fallback, username: '', password: '', token: '', key: '', value: '', in: 'header' })
    .catch({ type: fallback, username: '', password: '', token: '', key: '', value: '', in: 'header' })
export type Auth = z.output<ReturnType<typeof authSchema>>

const scriptsSchema = z.object({ pre: text(), post: text() }).default({ pre: '', post: '' }).catch({ pre: '', post: '' })
export type Scripts = z.output<typeof scriptsSchema>

export const ASSERT_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'notContains',
  'matches',
  'exists',
  'notExists',
  'isType',
  'length'
] as const
export type AssertOperator = (typeof ASSERT_OPERATORS)[number]

export const assertionSchema = z.object({
  /** Expression evaluated against the response, e.g. `res.status` or `res.body.items[0].id`. */
  expr: z.string(),
  op: z.enum(ASSERT_OPERATORS).default('eq').catch('eq'),
  value: z.unknown().optional(),
  enabled: bool(true)
})
export type Assertion = z.output<typeof assertionSchema>

export const DEFAULT_TIMEOUT_MS = 30_000

const settingsSchema = z
  .object({
    /** Milliseconds; 0 means the default. */
    timeout: int(0),
    followRedirects: bool(true),
    maxRedirects: int(5)
  })
  .default({ timeout: 0, followRedirects: true, maxRedirects: 5 })
  .catch({ timeout: 0, followRedirects: true, maxRedirects: 5 })
export type RequestSettings = z.output<typeof settingsSchema>

export const requestSchema = z.object({
  name: z.string().min(1).catch('Untitled'),
  seq: int(0),
  method: z
    .string()
    .default('GET')
    .catch('GET')
    .transform((m) => m.toUpperCase()),
  url: text(),
  params: list(paramSchema),
  headers: list(keyValueSchema),
  auth: authSchema('inherit'),
  /** Several payload variants of the same request; the active one is sent. */
  bodies: list(bodySchema),
  activeBody: z.string().nullable().default(null).catch(null),
  vars: z
    .object({
      /** Set before the request, may use other variables. */
      pre: list(keyValueSchema),
      /** Set from the response: the value is an expression such as `res.body.id`. */
      post: list(keyValueSchema)
    })
    .default({ pre: [], post: [] })
    .catch({ pre: [], post: [] }),
  scripts: scriptsSchema,
  assertions: list(assertionSchema),
  tests: text(),
  docs: text(),
  tags: list(z.string()),
  settings: settingsSchema
})
export type HttpRequest = z.output<typeof requestSchema>

export const folderSchema = z.object({
  name: z.string().min(1).catch('Untitled'),
  seq: int(0),
  headers: list(keyValueSchema),
  auth: authSchema('inherit'),
  vars: list(keyValueSchema),
  scripts: scriptsSchema,
  tests: text(),
  docs: text()
})
export type Folder = z.output<typeof folderSchema>

export const COLLECTION_COLORS = [
  '#8b6cf0',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#64748b'
]

export const collectionSchema = z.object({
  name: z.string().min(1).catch('Untitled'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default(COLLECTION_COLORS[0])
    .catch(COLLECTION_COLORS[0]),
  headers: list(keyValueSchema),
  auth: authSchema('none'),
  vars: list(keyValueSchema),
  scripts: scriptsSchema,
  tests: text(),
  docs: text()
})
export type Collection = z.output<typeof collectionSchema>

export const environmentSchema = z.object({
  name: z.string().min(1).catch('Untitled'),
  /** Shared values, committed. */
  vars: list(keyValueSchema),
  /** Names of the secret variables: their values stay encrypted on each machine. */
  secrets: list(z.string()),
  /** Display order of the variable and secret names, when it is not the variables then the secrets. */
  order: list(z.string())
})
export type Environment = z.output<typeof environmentSchema>

// --------------------------------------------------------------- factories

export function newRequest(name: string, patch: Partial<HttpRequest> = {}): HttpRequest {
  return { ...requestSchema.parse({ name }), ...patch }
}

export function newBody(name: string, type: BodyType = 'json', content = ''): Body {
  return bodySchema.parse({ name, type, content })
}

export function newFolder(name: string): Folder {
  return folderSchema.parse({ name })
}

export function newCollection(name: string, color?: string): Collection {
  return collectionSchema.parse({ name, color })
}

export function newEnvironment(name: string): Environment {
  return environmentSchema.parse({ name })
}

/** The body sent by a request: the active one, else the first one. */
export function activeBody(request: HttpRequest): Body | null {
  return request.bodies.find((b) => b.name === request.activeBody) ?? request.bodies[0] ?? null
}

// ------------------------------------------------------------------ tree

export interface RequestNode {
  kind: 'request'
  /** Path of the file relative to the collection folder, e.g. `users/create-user.yaml`. */
  path: string
  name: string
  method: string
  seq: number
}

export interface FolderNode {
  kind: 'folder'
  /** Path of the folder relative to the collection folder, e.g. `users`. */
  path: string
  name: string
  seq: number
  children: TreeNode[]
}

export type TreeNode = RequestNode | FolderNode

export interface CollectionSummary {
  /** Folder name of the collection, its identifier. */
  slug: string
  name: string
  color: string
  children: TreeNode[]
}

export interface EnvironmentSummary {
  slug: string
  name: string
}
