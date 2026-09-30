// Reads and writes the collections of a workspace on disk:
//
//   collections/<collection>/collection.yaml
//   collections/<collection>/environments/<environment>.yaml
//   collections/<collection>/<folder>/folder.yaml
//   collections/<collection>/<folder>/<request>.yaml
//
// File and folder names are slugs of the display names. Every write returns
// the touched paths, relative to the workspace root, for the commit.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path'
import {
  collectionSchema,
  environmentSchema,
  folderSchema,
  requestSchema,
  type Collection,
  type CollectionSummary,
  type Environment,
  type EnvironmentSummary,
  type Folder,
  type HttpRequest,
  type TreeNode
} from '../model'
import { slugify, uniqueSlug } from '../slug'
import { COLLECTIONS_DIR } from './workspace'
import { collectionToFile, environmentToFile, folderToFile, requestToFile } from './serialize'
import { readYaml, writeYaml } from './yaml'

export const COLLECTION_FILE = 'collection.yaml'
export const FOLDER_FILE = 'folder.yaml'
export const ENVIRONMENTS_DIR = 'environments'
const EXTENSION = '.yaml'

export interface Written<T = string> {
  /** New identifier: collection slug, or node path inside the collection. */
  id: T
  /** Touched paths relative to the workspace root. */
  paths: string[]
  /** Previous identifier when the write renamed the file or folder. */
  renamedFrom?: T
}

export interface Removed {
  paths: string[]
}

function isRequestFile(name: string): boolean {
  return name.endsWith(EXTENSION) && name !== FOLDER_FILE && name !== COLLECTION_FILE && !name.startsWith('.')
}

function bySeqThenName(a: { seq: number; name: string }, b: { seq: number; name: string }): number {
  return a.seq - b.seq || a.name.localeCompare(b.name)
}

export class WorkspaceStore {
  constructor(readonly root: string) {}

  // --------------------------------------------------------------- paths

  private get collectionsDir(): string {
    return join(this.root, COLLECTIONS_DIR)
  }

  /** Absolute folder of a collection; refuses anything but a plain folder name. */
  collectionDir(slug: string): string {
    if (!slug || slug.includes('/') || slug.includes('\\') || slug.startsWith('.')) throw new Error(`Invalid collection: ${slug}`)
    return join(this.collectionsDir, slug)
  }

  /** Absolute path of a node inside a collection, refusing paths escaping it. */
  nodePath(slug: string, path: string): string {
    const base = this.collectionDir(slug)
    const target = resolve(base, path)
    if (target !== base && !target.startsWith(base + sep)) throw new Error(`Invalid path: ${path}`)
    if (path.split('/').some((part) => part.startsWith('.'))) throw new Error(`Invalid path: ${path}`)
    return target
  }

  /** Path relative to the workspace root, with forward slashes (git paths). */
  private rel(absolute: string): string {
    return relative(this.root, absolute).split(sep).join('/')
  }

  private assertCollection(slug: string): string {
    const dir = this.collectionDir(slug)
    if (!existsSync(join(dir, COLLECTION_FILE))) throw new Error(`Collection not found: ${slug}`)
    return dir
  }

  // --------------------------------------------------------- collections

  listCollections(): CollectionSummary[] {
    if (!existsSync(this.collectionsDir)) return []
    return readdirSync(this.collectionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(this.collectionsDir, entry.name, COLLECTION_FILE)))
      .map((entry) => {
        const collection = this.readCollection(entry.name)
        return { slug: entry.name, name: collection.name, color: collection.color, children: this.readTree(entry.name) }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  readCollection(slug: string): Collection {
    return collectionSchema.parse(readYaml(join(this.assertCollection(slug), COLLECTION_FILE)))
  }

  /** Creates (slug null) or updates a collection; a new name renames its folder. */
  writeCollection(slug: string | null, collection: Collection): Written {
    const wanted = slugify(collection.name)
    const taken = (candidate: string): boolean => existsSync(join(this.collectionsDir, candidate))
    if (slug === null) {
      const created = uniqueSlug(wanted, taken)
      const dir = this.collectionDir(created)
      mkdirSync(dir, { recursive: true })
      writeYaml(join(dir, COLLECTION_FILE), collectionToFile(collection))
      return { id: created, paths: [this.rel(dir)] }
    }
    const dir = this.assertCollection(slug)
    let target = slug
    if (slugify(this.readCollection(slug).name) !== wanted && wanted !== slug) {
      target = uniqueSlug(wanted, taken)
      renameSync(dir, this.collectionDir(target))
    }
    writeYaml(join(this.collectionDir(target), COLLECTION_FILE), collectionToFile(collection))
    const paths = [this.rel(join(this.collectionDir(target), COLLECTION_FILE))]
    if (target !== slug) paths.push(this.rel(dir), this.rel(this.collectionDir(target)))
    return { id: target, paths, renamedFrom: target !== slug ? slug : undefined }
  }

  removeCollection(slug: string): Removed {
    const dir = this.assertCollection(slug)
    rmSync(dir, { recursive: true, force: true })
    return { paths: [this.rel(dir)] }
  }

  // ---------------------------------------------------------------- tree

  /** Folders and requests under `path` (the collection root by default), ordered by seq. */
  readTree(slug: string, path = ''): TreeNode[] {
    const dir = path ? this.nodePath(slug, path) : this.collectionDir(slug)
    const nodes: TreeNode[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const childPath = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!path && entry.name === ENVIRONMENTS_DIR) continue
        const folder = this.readFolderOrDefault(slug, childPath)
        nodes.push({ kind: 'folder', path: childPath, name: folder.name, seq: folder.seq, children: this.readTree(slug, childPath) })
      } else if (isRequestFile(entry.name)) {
        const request = this.readRequest(slug, childPath)
        nodes.push({ kind: 'request', path: childPath, name: request.name, method: request.method, seq: request.seq })
      }
    }
    return nodes.sort(bySeqThenName)
  }

  /** Every request of a collection (or of a folder), depth first in tree order. */
  listRequests(slug: string, path = ''): string[] {
    return this.readTree(slug, path).flatMap((node) => (node.kind === 'request' ? [node.path] : this.listRequests(slug, node.path)))
  }

  private nextSeq(slug: string, parent: string): number {
    return this.readTree(slug, parent).reduce((max, node) => Math.max(max, node.seq), 0) + 1
  }

  // ------------------------------------------------------------- folders

  private readFolderOrDefault(slug: string, path: string): Folder {
    const file = join(this.nodePath(slug, path), FOLDER_FILE)
    return folderSchema.parse(existsSync(file) ? readYaml(file) : { name: basename(path) })
  }

  readFolder(slug: string, path: string): Folder {
    const dir = this.nodePath(slug, path)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Folder not found: ${path}`)
    return this.readFolderOrDefault(slug, path)
  }

  /** Creates a folder in `parent` (path null) or updates the folder at `path`. */
  writeFolder(slug: string, parent: string, path: string | null, folder: Folder): Written {
    this.assertCollection(slug)
    const wanted = slugify(folder.name)
    if (path === null) {
      const parentDir = parent ? this.nodePath(slug, parent) : this.collectionDir(slug)
      const reserved = (candidate: string): boolean => (!parent && candidate === ENVIRONMENTS_DIR) || existsSync(join(parentDir, candidate))
      const name = uniqueSlug(wanted, reserved)
      const created = parent ? `${parent}/${name}` : name
      const dir = this.nodePath(slug, created)
      mkdirSync(dir, { recursive: true })
      writeYaml(join(dir, FOLDER_FILE), folderToFile({ ...folder, seq: folder.seq || this.nextSeq(slug, parent) }))
      return { id: created, paths: [this.rel(dir)] }
    }
    const current = this.readFolder(slug, path)
    let target = path
    if (slugify(current.name) !== wanted && basename(path) !== wanted) {
      const parentPath = posix.dirname(path) === '.' ? '' : posix.dirname(path)
      const parentDir = dirname(this.nodePath(slug, path))
      const name = uniqueSlug(wanted, (candidate) => (!parentPath && candidate === ENVIRONMENTS_DIR) || existsSync(join(parentDir, candidate)))
      target = parentPath ? `${parentPath}/${name}` : name
      renameSync(this.nodePath(slug, path), this.nodePath(slug, target))
    }
    const file = join(this.nodePath(slug, target), FOLDER_FILE)
    writeYaml(file, folderToFile(folder))
    const paths = [this.rel(file)]
    if (target !== path) paths.push(this.rel(this.nodePath(slug, path)), this.rel(this.nodePath(slug, target)))
    return { id: target, paths, renamedFrom: target !== path ? path : undefined }
  }

  removeFolder(slug: string, path: string): Removed {
    if (!path) throw new Error('Cannot remove the collection root')
    this.readFolder(slug, path)
    const dir = this.nodePath(slug, path)
    rmSync(dir, { recursive: true, force: true })
    return { paths: [this.rel(dir)] }
  }

  // ------------------------------------------------------------ requests

  readRequest(slug: string, path: string): HttpRequest {
    const file = this.nodePath(slug, path)
    if (!isRequestFile(basename(file)) || !existsSync(file)) throw new Error(`Request not found: ${path}`)
    return requestSchema.parse(readYaml(file))
  }

  /** Creates a request in `parent` (path null) or updates the request at `path`; a new name renames the file. */
  writeRequest(slug: string, parent: string, path: string | null, request: HttpRequest): Written {
    this.assertCollection(slug)
    const wanted = slugify(request.name)
    const fileTaken = (dir: string) => (candidate: string) =>
      candidate === 'folder' || candidate === 'collection' || existsSync(join(dir, candidate + EXTENSION))
    if (path === null) {
      const parentDir = parent ? this.nodePath(slug, parent) : this.collectionDir(slug)
      if (!existsSync(parentDir)) throw new Error(`Folder not found: ${parent}`)
      const name = uniqueSlug(wanted, fileTaken(parentDir)) + EXTENSION
      const created = parent ? `${parent}/${name}` : name
      const file = this.nodePath(slug, created)
      writeYaml(file, requestToFile({ ...request, seq: request.seq || this.nextSeq(slug, parent) }))
      return { id: created, paths: [this.rel(file)] }
    }
    const current = this.readRequest(slug, path)
    let target = path
    if (slugify(current.name) !== wanted && basename(path, EXTENSION) !== wanted) {
      const parentPath = posix.dirname(path) === '.' ? '' : posix.dirname(path)
      const name = uniqueSlug(wanted, fileTaken(dirname(this.nodePath(slug, path)))) + EXTENSION
      target = parentPath ? `${parentPath}/${name}` : name
      renameSync(this.nodePath(slug, path), this.nodePath(slug, target))
    }
    writeYaml(this.nodePath(slug, target), requestToFile(request))
    const paths = [this.rel(this.nodePath(slug, target))]
    if (target !== path) paths.push(this.rel(this.nodePath(slug, path)))
    return { id: target, paths, renamedFrom: target !== path ? path : undefined }
  }

  removeRequest(slug: string, path: string): Removed {
    this.readRequest(slug, path)
    const file = this.nodePath(slug, path)
    rmSync(file)
    return { paths: [this.rel(file)] }
  }

  // --------------------------------------------------------------- moves

  /**
   * Moves a request or folder into `parent`, placed before the sibling
   * `before` (at the end when null), and renumbers the siblings.
   */
  move(slug: string, from: string, parent: string, before: string | null): Written {
    const source = this.nodePath(slug, from)
    if (!existsSync(source)) throw new Error(`Not found: ${from}`)
    const isFolder = statSync(source).isDirectory()
    if (isFolder && (parent === from || parent.startsWith(`${from}/`))) throw new Error('Cannot move a folder into itself')
    const parentDir = parent ? this.nodePath(slug, parent) : this.collectionDir(slug)
    if (!existsSync(parentDir)) throw new Error(`Folder not found: ${parent}`)

    const paths: string[] = []
    let target = from
    const currentParent = posix.dirname(from) === '.' ? '' : posix.dirname(from)
    if (currentParent !== parent) {
      const extension = isFolder ? '' : EXTENSION
      const base = basename(from, extension)
      const name =
        uniqueSlug(base, (candidate) => (!parent && isFolder && candidate === ENVIRONMENTS_DIR) || existsSync(join(parentDir, candidate + extension))) +
        extension
      target = parent ? `${parent}/${name}` : name
      renameSync(source, this.nodePath(slug, target))
      paths.push(this.rel(source), this.rel(this.nodePath(slug, target)))
    }

    const siblings = this.readTree(slug, parent).filter((node) => node.path !== target)
    const index = before === null ? -1 : siblings.findIndex((node) => node.path === before)
    const moved = this.readTree(slug, parent).find((node) => node.path === target)!
    siblings.splice(index === -1 ? siblings.length : index, 0, moved)
    siblings.forEach((node, i) => {
      const seq = i + 1
      if (node.seq === seq && node.path !== target) return
      if (node.kind === 'request') {
        const file = this.nodePath(slug, node.path)
        writeYaml(file, requestToFile({ ...this.readRequest(slug, node.path), seq }))
        paths.push(this.rel(file))
      } else {
        const file = join(this.nodePath(slug, node.path), FOLDER_FILE)
        writeYaml(file, folderToFile({ ...this.readFolderOrDefault(slug, node.path), seq }))
        paths.push(this.rel(file))
      }
    })
    return { id: target, paths, renamedFrom: target !== from ? from : undefined }
  }

  // -------------------------------------------------------- environments

  private environmentsDir(slug: string): string {
    return join(this.assertCollection(slug), ENVIRONMENTS_DIR)
  }

  private environmentFile(slug: string, env: string): string {
    if (!env || env.includes('/') || env.startsWith('.')) throw new Error(`Invalid environment: ${env}`)
    return join(this.environmentsDir(slug), env + EXTENSION)
  }

  listEnvironments(slug: string): EnvironmentSummary[] {
    const dir = this.environmentsDir(slug)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter(isRequestFile)
      .map((file) => ({ slug: basename(file, EXTENSION), name: this.readEnvironment(slug, basename(file, EXTENSION)).name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  readEnvironment(slug: string, env: string): Environment {
    const file = this.environmentFile(slug, env)
    if (!existsSync(file)) throw new Error(`Environment not found: ${env}`)
    return environmentSchema.parse(readYaml(file))
  }

  /** Finds an environment by slug or display name (CLI and MCP convenience). */
  findEnvironment(slug: string, nameOrSlug: string): string {
    const found = this.listEnvironments(slug).find((e) => e.slug === nameOrSlug || e.name === nameOrSlug)
    if (!found) throw new Error(`Environment not found: ${nameOrSlug}`)
    return found.slug
  }

  writeEnvironment(slug: string, env: string | null, environment: Environment): Written {
    const dir = this.environmentsDir(slug)
    mkdirSync(dir, { recursive: true })
    const wanted = slugify(environment.name)
    const taken = (candidate: string): boolean => existsSync(join(dir, candidate + EXTENSION))
    let target = env ?? uniqueSlug(wanted, taken)
    const paths: string[] = []
    if (env !== null && slugify(this.readEnvironment(slug, env).name) !== wanted && env !== wanted) {
      target = uniqueSlug(wanted, taken)
      renameSync(this.environmentFile(slug, env), this.environmentFile(slug, target))
      paths.push(this.rel(this.environmentFile(slug, env)))
    }
    writeYaml(this.environmentFile(slug, target), environmentToFile(environment))
    paths.push(this.rel(this.environmentFile(slug, target)))
    return { id: target, paths, renamedFrom: env !== null && target !== env ? env : undefined }
  }

  removeEnvironment(slug: string, env: string): Removed {
    const file = this.environmentFile(slug, env)
    if (!existsSync(file)) throw new Error(`Environment not found: ${env}`)
    rmSync(file)
    return { paths: [this.rel(file)] }
  }
}

/** Writes raw text (used by importers for files kept as-is). */
export function writeText(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}
