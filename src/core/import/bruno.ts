// Imports a Bruno collection folder (bruno.json, collection.bru, folder.bru,
// *.bru requests and environments/*.bru). Collections in the YAML format of
// Bruno 3 are read by ./opencollection.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
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
  type FormField,
  type HttpRequest,
  type KeyValue,
  type Param
} from '../model'
import { convertScript, type ImportedCollection, type ImportedItem } from './imported'
import { importOpenCollection } from './opencollection'

interface BruRow {
  name: string
  value: string
  enabled: boolean
}

/** A parsed .bru file: blocks by name, each a key/value list, a text or a list. */
export interface BruFile {
  dicts: Map<string, BruRow[]>
  texts: Map<string, string>
  lists: Map<string, string[]>
}

const TEXT_BLOCKS = /^(body(:[\w-]+)*|script:[\w-]+|tests|docs)$/

export function parseBru(source: string): BruFile {
  const file: BruFile = { dicts: new Map(), texts: new Map(), lists: new Map() }
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const header = /^([\w:-]+)\s*([{[])\s*$/.exec(lines[i])
    if (!header) continue
    const [, name, open] = header
    const close = open === '{' ? '}' : ']'
    const body: string[] = []
    for (i++; i < lines.length && lines[i] !== close; i++) body.push(lines[i])
    // Form bodies are key/value blocks despite their body: prefix.
    const isText = TEXT_BLOCKS.test(name) && name !== 'body:form-urlencoded' && name !== 'body:multipart-form' && name !== 'body:file'
    if (open === '[') {
      file.lists.set(name, body.map((l) => l.trim().replace(/,$/, '')).filter(Boolean))
    } else if (isText) {
      file.texts.set(name, body.map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n'))
    } else {
      file.dicts.set(
        name,
        body
          .filter((l) => l.trim())
          .map((line) => {
            const trimmed = line.trim()
            const enabled = !trimmed.startsWith('~')
            const entry = enabled ? trimmed : trimmed.slice(1)
            const colon = entry.indexOf(':')
            return colon === -1
              ? { name: entry, value: '', enabled }
              : { name: entry.slice(0, colon).trim(), value: entry.slice(colon + 1).trim(), enabled }
          })
      )
    }
  }
  return file
}

const kv = (rows: BruRow[] | undefined): KeyValue[] =>
  (rows ?? []).map((r) => ({ name: r.name, value: r.value, enabled: r.enabled, description: '' }))

function dictValue(file: BruFile, block: string, key: string): string | undefined {
  return file.dicts.get(block)?.find((r) => r.name === key)?.value
}

function auth(file: BruFile, mode: string | undefined, fallback: Auth['type']): Auth {
  const base: Auth = { type: fallback, username: '', password: '', token: '', key: '', value: '', in: 'header' }
  switch (mode) {
    case 'basic':
      return {
        ...base,
        type: 'basic',
        username: dictValue(file, 'auth:basic', 'username') ?? '',
        password: dictValue(file, 'auth:basic', 'password') ?? ''
      }
    case 'bearer':
      return { ...base, type: 'bearer', token: dictValue(file, 'auth:bearer', 'token') ?? '' }
    case 'apikey':
      return {
        ...base,
        type: 'apikey',
        key: dictValue(file, 'auth:apikey', 'key') ?? '',
        value: dictValue(file, 'auth:apikey', 'value') ?? '',
        in: dictValue(file, 'auth:apikey', 'placement') === 'queryparams' ? 'query' : 'header'
      }
    case 'inherit':
      return { ...base, type: 'inherit' }
    case 'none':
      return { ...base, type: 'none' }
    default:
      return base
  }
}

function assertions(file: BruFile): Assertion[] {
  return (file.dicts.get('assert') ?? []).map((row) => {
    const [op, ...rest] = row.value.split(' ')
    const known = (ASSERT_OPERATORS as readonly string[]).includes(op)
    return {
      expr: row.name,
      op: (known ? op : 'eq') as AssertOperator,
      value: known ? rest.join(' ') : row.value,
      enabled: row.enabled
    }
  })
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace']

function body(file: BruFile, mode: string | undefined): Body[] {
  switch (mode) {
    case 'json':
    case 'xml':
    case 'text':
      return [newBody('Default', mode, file.texts.get(`body:${mode}`) ?? '')]
    case 'graphql':
      return [
        { ...newBody('Default', 'graphql', file.texts.get('body:graphql') ?? ''), variables: file.texts.get('body:graphql:vars') ?? '' }
      ]
    case 'formUrlEncoded':
      return [
        { ...newBody('Default', 'form'), fields: kv(file.dicts.get('body:form-urlencoded')).map((f) => ({ ...f, type: 'text' as const })) }
      ]
    case 'multipartForm':
      return [
        {
          ...newBody('Default', 'multipart'),
          fields: (file.dicts.get('body:multipart-form') ?? []).map((row): FormField => {
            const fileRef = /^@file\((.*)\)$/.exec(row.value)
            return {
              name: row.name,
              value: fileRef ? fileRef[1] : row.value,
              enabled: row.enabled,
              description: '',
              type: fileRef ? 'file' : 'text'
            }
          })
        }
      ]
    default:
      return []
  }
}

export function bruToRequest(file: BruFile, fallbackName: string): HttpRequest {
  const method = METHODS.find((m) => file.dicts.has(m)) ?? 'get'
  const block = method
  const params: Param[] = [
    ...kv(file.dicts.get('params:path')).map((p) => ({ ...p, type: 'path' as const })),
    ...kv(file.dicts.get('params:query')).map((p) => ({ ...p, type: 'query' as const }))
  ]
  const url = dictValue(file, block, 'url') ?? ''
  const tags =
    file.lists.get('tags') ??
    (dictValue(file, 'meta', 'tags') ?? '')
      .replace(/[[\]]/g, '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  return newRequest(dictValue(file, 'meta', 'name') || fallbackName, {
    seq: Number(dictValue(file, 'meta', 'seq')) || 0,
    method: method.toUpperCase(),
    // Bruno keeps the query string in the URL and in params:query: Milka only in params.
    url: url.split('?')[0],
    params,
    headers: kv(file.dicts.get('headers')),
    auth: auth(file, dictValue(file, block, 'auth'), 'inherit'),
    bodies: body(file, dictValue(file, block, 'body')),
    vars: { pre: kv(file.dicts.get('vars:pre-request')), post: kv(file.dicts.get('vars:post-response')) },
    scripts: {
      pre: convertScript(file.texts.get('script:pre-request') ?? '', 'Bruno'),
      post: convertScript(file.texts.get('script:post-response') ?? '', 'Bruno')
    },
    assertions: assertions(file),
    tests: convertScript(file.texts.get('tests') ?? '', 'Bruno'),
    docs: file.texts.get('docs') ?? '',
    tags
  })
}

function folderSettings(file: BruFile) {
  return {
    headers: kv(file.dicts.get('headers')),
    vars: kv(file.dicts.get('vars:pre-request')),
    scripts: {
      pre: convertScript(file.texts.get('script:pre-request') ?? '', 'Bruno'),
      post: convertScript(file.texts.get('script:post-response') ?? '', 'Bruno')
    },
    tests: convertScript(file.texts.get('tests') ?? '', 'Bruno'),
    docs: file.texts.get('docs') ?? ''
  }
}

function readItems(dir: string, warnings: string[], root: boolean): ImportedItem[] {
  const items: { seq: number; item: ImportedItem }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (root && entry.name === 'environments') continue
      const folderFile = join(path, 'folder.bru')
      const parsed = existsSync(folderFile) ? parseBru(readFileSync(folderFile, 'utf8')) : null
      const folder = {
        ...newFolder(parsed ? dictValue(parsed, 'meta', 'name') || entry.name : entry.name),
        ...(parsed ? { ...folderSettings(parsed), auth: auth(parsed, dictValue(parsed, 'auth', 'mode'), 'inherit') } : {})
      }
      items.push({
        seq: Number(parsed && dictValue(parsed, 'meta', 'seq')) || 0,
        item: { kind: 'folder', folder, items: readItems(path, warnings, false) }
      })
    } else if (entry.name.endsWith('.bru') && entry.name !== 'folder.bru' && entry.name !== 'collection.bru') {
      const file = parseBru(readFileSync(path, 'utf8'))
      const type = dictValue(file, 'meta', 'type')
      if (type && type !== 'http' && type !== 'graphql') {
        warnings.push(`${entry.name}: ${type} requests are not supported yet, skipped`)
        continue
      }
      const request = bruToRequest(file, basename(entry.name, '.bru'))
      items.push({ seq: request.seq, item: { kind: 'request', request } })
    }
  }
  return items.sort((a, b) => a.seq - b.seq).map((i) => i.item)
}

/** Imports a Bruno collection folder, in the .bru format or in the YAML format of Bruno 3. */
export function importBruno(dir: string): ImportedCollection {
  if (existsSync(join(dir, 'opencollection.yml'))) return importOpenCollection(dir)
  const manifest = join(dir, 'bruno.json')
  if (!existsSync(manifest)) {
    if (existsSync(join(dir, 'workspace.yml')))
      throw new Error(`${dir} is a Bruno workspace: import its collections one by one, from its collections folder`)
    throw new Error(`Not a Bruno collection: ${dir} has neither bruno.json nor opencollection.yml`)
  }
  const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
  const warnings: string[] = []
  const collectionFile = join(dir, 'collection.bru')
  const parsed = existsSync(collectionFile) ? parseBru(readFileSync(collectionFile, 'utf8')) : null
  const collection = {
    ...newCollection(name || basename(dir)),
    ...(parsed ? { ...folderSettings(parsed), auth: auth(parsed, dictValue(parsed, 'auth', 'mode'), 'none') } : {})
  }
  const environments = []
  const envDir = join(dir, 'environments')
  if (existsSync(envDir)) {
    for (const file of readdirSync(envDir).filter((f) => f.endsWith('.bru'))) {
      const env = parseBru(readFileSync(join(envDir, file), 'utf8'))
      const secrets = env.lists.get('vars:secret') ?? []
      environments.push({
        ...newEnvironment(basename(file, '.bru')),
        vars: kv(env.dicts.get('vars')).filter((v) => !secrets.includes(v.name)),
        secrets
      })
    }
  }
  return { collection, environments, items: readItems(dir, warnings, true), warnings }
}
