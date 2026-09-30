// Root files of a workspace repository.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const WORKSPACE_FILE = 'milka.json'
export const COLLECTIONS_DIR = 'collections'
export const FORMAT_VERSION = 1

export interface WorkspaceFile {
  name: string
  formatVersion: number
}

/** Creates the workspace marker and the collections folder when missing. */
export function ensureWorkspaceLayout(dir: string, name: string): void {
  mkdirSync(join(dir, COLLECTIONS_DIR), { recursive: true })
  const marker = join(dir, WORKSPACE_FILE)
  if (!existsSync(marker)) writeJson(marker, { name, formatVersion: FORMAT_VERSION } satisfies WorkspaceFile)
  const keep = join(dir, COLLECTIONS_DIR, '.gitkeep')
  if (!existsSync(keep)) writeFileSync(keep, '')
}

export function readWorkspaceFile(dir: string): WorkspaceFile | null {
  try {
    return JSON.parse(readFileSync(join(dir, WORKSPACE_FILE), 'utf8')) as WorkspaceFile
  } catch {
    return null
  }
}

/** Pretty JSON with a trailing newline, for clean diffs. */
export function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}
