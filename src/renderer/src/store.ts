// UI state: open tabs and the environment selected per collection.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TabKind = 'request' | 'collection' | 'folder' | 'runner'

export interface Tab {
  id: string
  kind: TabKind
  collection: string
  /** Node path inside the collection (requests and folders). */
  path: string
}

interface AppState {
  tabs: Tab[]
  activeTabId: string | null
  /** Tabs with unsaved changes. */
  dirty: Record<string, boolean>
  /** Selected environment slug per `<repoId>:<collection>`. */
  environments: Record<string, string | null>
  theme: 'dark' | 'light'
}

export const useApp = create<AppState>()(
  persist(() => ({ tabs: [], activeTabId: null, dirty: {}, environments: {}, theme: 'dark' as const }) as AppState, {
    name: 'milka-ui',
    partialize: (s) => ({ environments: s.environments, theme: s.theme })
  })
)

export function tabId(kind: TabKind, collection: string, path = ''): string {
  return `${kind}:${collection}:${path}`
}

export function openTab(kind: TabKind, collection: string, path = ''): void {
  const id = tabId(kind, collection, path)
  useApp.setState((s) => ({
    tabs: s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, { id, kind, collection, path }],
    activeTabId: id
  }))
}

export function closeTab(id: string): void {
  useApp.setState((s) => {
    const index = s.tabs.findIndex((t) => t.id === id)
    const tabs = s.tabs.filter((t) => t.id !== id)
    const activeTabId = s.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeTabId
    return { tabs, activeTabId }
  })
}

/** Closes every tab of a collection, or of the node at `path` and below. */
export function closeTabsUnder(collection: string, path?: string): void {
  for (const tab of useApp.getState().tabs) {
    if (tab.collection !== collection) continue
    if (path === undefined || tab.path === path || tab.path.startsWith(`${path}/`)) closeTab(tab.id)
  }
}

/**
 * Follows a renamed or moved node in the open tabs. With `from` empty, the
 * whole collection was renamed to `toCollection`.
 */
export function retargetTabs(collection: string, from: string, to: string, toCollection = collection): void {
  useApp.setState((s) => {
    let activeTabId = s.activeTabId
    const tabs = s.tabs.map((tab) => {
      if (tab.collection !== collection) return tab
      let path: string
      if (from === '') path = tab.path
      else if (tab.path === from) path = to
      else if (tab.path.startsWith(`${from}/`)) path = to + tab.path.slice(from.length)
      else return tab
      const id = tabId(tab.kind, toCollection, path)
      if (activeTabId === tab.id) activeTabId = id
      return { ...tab, id, collection: toCollection, path }
    })
    return { tabs, activeTabId }
  })
}

export function closeAllTabs(): void {
  useApp.setState({ tabs: [], activeTabId: null, dirty: {} })
}

export function setDirty(id: string, dirty: boolean): void {
  if ((useApp.getState().dirty[id] ?? false) === dirty) return
  useApp.setState((s) => ({ dirty: { ...s.dirty, [id]: dirty } }))
}

export function selectedEnvironment(repoId: string, collection: string): string | null {
  return useApp.getState().environments[`${repoId}:${collection}`] ?? null
}

export function selectEnvironment(repoId: string, collection: string, env: string | null): void {
  useApp.setState((s) => ({ environments: { ...s.environments, [`${repoId}:${collection}`]: env } }))
}

export function setTheme(theme: 'dark' | 'light'): void {
  document.documentElement.classList.toggle('light', theme === 'light')
  useApp.setState({ theme })
}
