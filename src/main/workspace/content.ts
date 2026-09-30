// Collections, folders, requests and environments of the active workspace.
// Every change is committed with its own message; secret values of
// environments go to the local secret store, never to the repository.
import { WorkspaceStore } from '@core/layout/store'
import type { Collection, CollectionSummary, Environment, EnvironmentSummary, Folder, HttpRequest } from '@core/model'
import type { EnvironmentDraft } from '@shared/types'
import type { SecretStore, SecretValues } from '../secrets'
import type { WorkspaceManager } from './manager'

export function secretScope(collection: string, env: string): string {
  return `${collection}/${env}`
}

export class ContentService {
  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly secrets: SecretStore
  ) {}

  store(): WorkspaceStore {
    return new WorkspaceStore(this.workspace.active().path)
  }

  // ---------------------------------------------------------- collections

  listCollections(): CollectionSummary[] {
    return this.store().listCollections()
  }

  getCollection(slug: string): Collection {
    return this.store().readCollection(slug)
  }

  async saveCollection(slug: string | null, collection: Collection): Promise<string> {
    const repo = this.workspace.active()
    const written = await this.workspace.change(repo, () => {
      const result = new WorkspaceStore(repo.path).writeCollection(slug, collection)
      const verb = slug === null ? 'Add' : result.renamedFrom ? 'Rename' : 'Update'
      return { result, paths: result.paths, message: `${verb} collection "${collection.name}"` }
    })
    // Secrets of the environments follow the renamed folder.
    if (written.renamedFrom) this.secrets.move(repo.id, written.renamedFrom, written.id)
    return written.id
  }

  async removeCollection(slug: string): Promise<void> {
    const repo = this.workspace.active()
    await this.workspace.change(repo, () => {
      const store = new WorkspaceStore(repo.path)
      const { name } = store.readCollection(slug)
      return { result: undefined, paths: store.removeCollection(slug).paths, message: `Remove collection "${name}"` }
    })
    this.secrets.forget(repo.id, slug)
  }

  // -------------------------------------------------------------- folders

  getFolder(slug: string, path: string): Folder {
    return this.store().readFolder(slug, path)
  }

  saveFolder(slug: string, parent: string, path: string | null, folder: Folder): Promise<string> {
    const repo = this.workspace.active()
    return this.workspace.change(repo, () => {
      const result = new WorkspaceStore(repo.path).writeFolder(slug, parent, path, folder)
      const verb = path === null ? 'Add' : result.renamedFrom ? 'Rename' : 'Update'
      return { result: result.id, paths: result.paths, message: `${verb} folder "${folder.name}"` }
    })
  }

  removeFolder(slug: string, path: string): Promise<void> {
    const repo = this.workspace.active()
    return this.workspace.change(repo, () => {
      const store = new WorkspaceStore(repo.path)
      const { name } = store.readFolder(slug, path)
      return { result: undefined, paths: store.removeFolder(slug, path).paths, message: `Remove folder "${name}"` }
    })
  }

  // ------------------------------------------------------------- requests

  getRequest(slug: string, path: string): HttpRequest {
    return this.store().readRequest(slug, path)
  }

  saveRequest(slug: string, parent: string, path: string | null, request: HttpRequest): Promise<string> {
    const repo = this.workspace.active()
    return this.workspace.change(repo, () => {
      const result = new WorkspaceStore(repo.path).writeRequest(slug, parent, path, request)
      const verb = path === null ? 'Add' : result.renamedFrom ? 'Rename' : 'Update'
      return { result: result.id, paths: result.paths, message: `${verb} request "${request.name}"` }
    })
  }

  duplicateRequest(slug: string, path: string): Promise<string> {
    const request = this.getRequest(slug, path)
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    return this.saveRequest(slug, parent, null, { ...request, name: `${request.name} (copy)`, seq: 0 })
  }

  removeRequest(slug: string, path: string): Promise<void> {
    const repo = this.workspace.active()
    return this.workspace.change(repo, () => {
      const store = new WorkspaceStore(repo.path)
      const { name } = store.readRequest(slug, path)
      return { result: undefined, paths: store.removeRequest(slug, path).paths, message: `Remove request "${name}"` }
    })
  }

  move(slug: string, from: string, parent: string, before: string | null): Promise<string> {
    const repo = this.workspace.active()
    return this.workspace.change(repo, () => {
      const store = new WorkspaceStore(repo.path)
      const result = store.move(slug, from, parent, before)
      const name = store.readTree(slug, parent).find((node) => node.path === result.id)?.name ?? result.id
      return { result: result.id, paths: result.paths, message: `Move "${name}"` }
    })
  }

  /** Every variable name defined in a collection, its folders, requests and environments. */
  variableNames(slug: string): string[] {
    const store = this.store()
    const names = new Set<string>()
    const add = (rows: { name: string }[]): void => rows.forEach((row) => row.name && names.add(row.name))
    add(store.readCollection(slug).vars)
    for (const env of store.listEnvironments(slug)) {
      const environment = store.readEnvironment(slug, env.slug)
      add(environment.vars)
      environment.secrets.forEach((name) => names.add(name))
    }
    const walk = (nodes: ReturnType<WorkspaceStore['readTree']>): void => {
      for (const node of nodes) {
        if (node.kind === 'folder') {
          add(store.readFolder(slug, node.path).vars)
          walk(node.children)
        } else {
          const request = store.readRequest(slug, node.path)
          add(request.vars.pre)
          add(request.vars.post)
        }
      }
    }
    walk(store.readTree(slug))
    return [...names].sort()
  }

  // --------------------------------------------------------- environments

  listEnvironments(slug: string): EnvironmentSummary[] {
    return this.store().listEnvironments(slug)
  }

  getEnvironment(slug: string, env: string): EnvironmentDraft {
    const repo = this.workspace.active()
    const environment = this.store().readEnvironment(slug, env)
    const { values, unreadable } = this.secrets.read(repo.id, secretScope(slug, env))
    return { environment, secretValues: values, secretsUnreadable: unreadable }
  }

  /** Secret values of an environment, for sending requests. */
  secretValues(slug: string, env: string): SecretValues {
    return this.secrets.get(this.workspace.active().id, secretScope(slug, env))
  }

  async saveEnvironment(slug: string, env: string | null, environment: Environment, secretValues: SecretValues): Promise<string> {
    const repo = this.workspace.active()
    const written = await this.workspace.change(repo, () => {
      const result = new WorkspaceStore(repo.path).writeEnvironment(slug, env, environment)
      const verb = env === null ? 'Add' : result.renamedFrom ? 'Rename' : 'Update'
      return { result, paths: result.paths, message: `${verb} environment "${environment.name}"` }
    })
    if (written.renamedFrom) this.secrets.move(repo.id, secretScope(slug, written.renamedFrom), secretScope(slug, written.id))
    const kept = Object.fromEntries(environment.secrets.map((name) => [name, secretValues[name] ?? '']))
    this.secrets.set(repo.id, secretScope(slug, written.id), kept)
    return written.id
  }

  async removeEnvironment(slug: string, env: string): Promise<void> {
    const repo = this.workspace.active()
    await this.workspace.change(repo, () => {
      const store = new WorkspaceStore(repo.path)
      const { name } = store.readEnvironment(slug, env)
      return { result: undefined, paths: store.removeEnvironment(slug, env).paths, message: `Remove environment "${name}"` }
    })
    this.secrets.forget(repo.id, secretScope(slug, env))
  }
}
