// Workspaces known to the app, read from its registry, for the CLI and the MCP server.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { WorkspaceState } from '../shared/types'

/** The app's data folder: MILKA_DATA_DIR, else ~/.config/milka. */
export function dataDir(env: Record<string, string | undefined>): string {
  if (env.MILKA_DATA_DIR) return env.MILKA_DATA_DIR
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'milka')
}

export function readRegistry(env: Record<string, string | undefined>): WorkspaceState {
  const file = join(dataDir(env), 'workspaces.json')
  if (!existsSync(file)) return { repos: [], activeRepoId: null }
  try {
    return { repos: [], activeRepoId: null, ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<WorkspaceState>) }
  } catch {
    return { repos: [], activeRepoId: null }
  }
}

export interface KnownWorkspace {
  id: string | null
  name: string
  path: string
  active: boolean
}

/**
 * Workspaces the MCP server can use: the one given with --workspace, or
 * those registered in the app.
 */
export function knownWorkspaces(fixed: string | undefined, env: Record<string, string | undefined>): KnownWorkspace[] {
  if (fixed) return [{ id: null, name: fixed.split('/').pop() || fixed, path: resolve(fixed), active: true }]
  const registry = readRegistry(env)
  return registry.repos.map((repo) => ({ id: repo.id, name: repo.name, path: repo.path, active: repo.id === registry.activeRepoId }))
}
