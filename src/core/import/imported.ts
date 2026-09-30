// In-memory collection produced by the importers, written to a workspace in one go.
import type { WorkspaceStore } from '../layout/store'
import type { Collection, Environment, Folder, HttpRequest } from '../model'

export type ImportedItem = { kind: 'folder'; folder: Folder; items: ImportedItem[] } | { kind: 'request'; request: HttpRequest }

export interface ImportedCollection {
  collection: Collection
  environments: Environment[]
  items: ImportedItem[]
  /** Things that could not be carried over, shown to the user. */
  warnings: string[]
}

export interface ImportResult {
  slug: string
  /** Paths written, relative to the workspace root. */
  paths: string[]
  requests: number
  warnings: string[]
}

/** Writes an imported collection as a new collection of the workspace. */
export function writeImported(store: WorkspaceStore, imported: ImportedCollection): ImportResult {
  const { id: slug, paths } = store.writeCollection(null, imported.collection)
  let requests = 0
  const writeItems = (parent: string, items: ImportedItem[]): void => {
    items.forEach((item, index) => {
      if (item.kind === 'folder') {
        const { id } = store.writeFolder(slug, parent, null, { ...item.folder, seq: index + 1 })
        writeItems(id, item.items)
      } else {
        store.writeRequest(slug, parent, null, { ...item.request, seq: index + 1 })
        requests++
      }
    })
  }
  writeItems('', imported.items)
  for (const environment of imported.environments) store.writeEnvironment(slug, null, environment)
  return { slug, paths, requests, warnings: imported.warnings }
}

/** Replaces the calls of other tools' script APIs that have a Milka equivalent. */
export function convertScript(code: string, tool: 'Bruno' | 'Postman'): string {
  if (!code.trim()) return ''
  const converted = code
    // Bruno
    .replace(/\bbru\.setVar\(/g, 'milka.vars.set(')
    .replace(/\bbru\.getVar\(/g, 'milka.vars.get(')
    .replace(/\bbru\.setEnvVar\(/g, 'milka.vars.set(')
    .replace(/\bbru\.getEnvVar\(/g, 'milka.env.get(')
    .replace(/\bbru\.getEnvName\(\)/g, 'milka.env.name')
    .replace(/\bbru\.sleep\(/g, 'milka.sleep(')
    .replace(/\bres\.getBody\(\)/g, 'res.body')
    .replace(/\bres\.getStatus\(\)/g, 'res.status')
    .replace(/\bres\.getHeaders\(\)/g, 'res.headers')
    .replace(/\bres\.getHeader\(/g, 'res.header(')
    .replace(/\bres\.getResponseTime\(\)/g, 'res.time')
    .replace(/\breq\.getUrl\(\)/g, 'req.url')
    .replace(/\breq\.getMethod\(\)/g, 'req.method')
    .replace(/\breq\.getBody\(\)/g, 'req.body')
    .replace(/\breq\.getHeader\(([^)]*)\)/g, 'req.headers[$1]')
    // Postman
    .replace(/\bpm\.(environment|collectionVariables|globals|variables)\.set\(/g, 'milka.vars.set(')
    .replace(/\bpm\.(collectionVariables|globals|variables)\.get\(/g, 'milka.vars.get(')
    .replace(/\bpm\.environment\.get\(/g, 'milka.env.get(')
    .replace(/\bpm\.(environment|collectionVariables|globals|variables)\.unset\(/g, 'milka.vars.delete(')
    .replace(/\bpm\.response\.json\(\)/g, 'res.body')
    .replace(/\bpm\.response\.text\(\)/g, 'res.text')
    .replace(/\bpm\.response\.code\b/g, 'res.status')
    .replace(/\bpm\.response\.responseTime\b/g, 'res.time')
    .replace(/\bpm\.response\.headers\.get\(/g, 'res.header(')
    .replace(/\bpm\.request\.headers\.add\(\{\s*key:\s*([^,]+),\s*value:\s*([^}]+?)\s*\}\)/g, 'req.setHeader($1, $2)')
    .replace(/\bpm\.request\.url\.toString\(\)/g, 'req.url')
    .replace(/\bpm\.test\(/g, 'test(')
    .replace(/\bpm\.expect\(/g, 'expect(')
  return `// Imported from ${tool}: check the calls Milka does not know (see the script API with Ctrl+Space).\n${converted}`
}
