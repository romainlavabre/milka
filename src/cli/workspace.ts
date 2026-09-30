// Finds the workspace, collection and node designated by a path on disk.
import { existsSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { COLLECTIONS_DIR, WORKSPACE_FILE } from '../core/layout/workspace'

export interface Target {
  /** Workspace root folder. */
  root: string
  /** Collection slug, null for every collection of the workspace. */
  collection: string | null
  /** Folder or request path inside the collection, empty for all of it. */
  path: string
}

export function findWorkspaceRoot(from: string): string | null {
  let dir = existsSync(from) && statSync(from).isFile() ? dirname(from) : from
  for (;;) {
    if (existsSync(resolve(dir, WORKSPACE_FILE))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * `collections/users-api/admin/list.yaml` → the request `admin/list.yaml` of
 * the collection `users-api`; the workspace root → every collection.
 */
export function resolveTarget(target: string, cwd: string): Target {
  const absolute = resolve(cwd, target)
  if (!existsSync(absolute)) throw new UsageError(`No such file or folder: ${target}`)
  const root = findWorkspaceRoot(absolute)
  if (!root) throw new UsageError(`${target} is not inside a Milka workspace (no ${WORKSPACE_FILE} found above it)`)
  const parts = relative(root, absolute).split(sep).filter(Boolean)
  if (parts.length === 0 || (parts.length === 1 && parts[0] === COLLECTIONS_DIR)) return { root, collection: null, path: '' }
  if (parts[0] !== COLLECTIONS_DIR) throw new UsageError(`${target} is not a collection, folder or request of the workspace`)
  return { root, collection: parts[1], path: parts.slice(2).join('/') }
}

export class UsageError extends Error {}
