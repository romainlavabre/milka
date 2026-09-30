// UI state: open tabs and the environment selected per collection.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearDrafts, draftsOfTab, forgetDraft } from './lib/drafts'

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
  /** Active workspace, which the pins below belong to. */
  repoId: string | null
  /** Selected environment slug per `<repoId>:<collection>`. */
  environments: Record<string, string | null>
  /** Pinned requests per workspace, in the order they were pinned: preferences of this machine, never in the workspace. */
  pins: Record<string, Pin[]>
  theme: 'dark' | 'light'
}

export interface Pin {
  collection: string
  path: string
}

export const useApp = create<AppState>()(
  persist(() => ({ tabs: [], activeTabId: null, repoId: null, environments: {}, pins: {}, theme: 'dark' as const }) as AppState, {
    name: 'milka-ui',
    partialize: (s) => ({ environments: s.environments, pins: s.pins, theme: s.theme })
  })
)

const NO_PINS: Pin[] = []

/** Pinned requests of the active workspace. */
export function usePins(): Pin[] {
  return useApp((s) => (s.repoId ? (s.pins[s.repoId] ?? NO_PINS) : NO_PINS))
}

export function useIsPinned(collection: string, path: string): boolean {
  return usePins().some((pin) => pin.collection === collection && pin.path === path)
}

function updatePins(update: (pins: Pin[]) => Pin[]): void {
  useApp.setState((s) => {
    if (!s.repoId) return s
    const current = s.pins[s.repoId] ?? []
    const next = update(current)
    return next === current ? s : { pins: { ...s.pins, [s.repoId]: next } }
  })
}

/** Pins a request at the bottom of the pinned ones, or unpins it. */
export function togglePin(collection: string, path: string): void {
  updatePins((pins) =>
    pins.some((pin) => pin.collection === collection && pin.path === path)
      ? pins.filter((pin) => !(pin.collection === collection && pin.path === path))
      : [...pins, { collection, path }]
  )
}

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

/** Closes a tab and forgets its unsaved changes: ask first with closeTabSafely. */
export function closeTab(id: string): void {
  for (const draft of draftsOfTab(id)) forgetDraft(draft.id)
  useApp.setState((s) => {
    const index = s.tabs.findIndex((t) => t.id === id)
    const tabs = s.tabs.filter((t) => t.id !== id)
    const activeTabId = s.activeTabId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeTabId
    return { tabs, activeTabId }
  })
}

/** Closes every tab of a collection, or of the node at `path` and below (deleted: their changes are dropped). */
export function closeTabsUnder(collection: string, path?: string): void {
  const under = (item: { collection: string; path: string }): boolean =>
    item.collection === collection && (path === undefined || item.path === path || item.path.startsWith(`${path}/`))
  for (const tab of useApp.getState().tabs) if (under(tab)) closeTab(tab.id)
  updatePins((pins) => (pins.some(under) ? pins.filter((pin) => !under(pin)) : pins))
}

/**
 * Follows a renamed or moved node in the open tabs and the pins. With `from`
 * empty, the whole collection was renamed to `toCollection`.
 */
export function retargetTabs(collection: string, from: string, to: string, toCollection = collection): void {
  // The new place of a node at `item`, null when it is not under the renamed one.
  const moved = (item: { collection: string; path: string }): { collection: string; path: string } | null => {
    if (item.collection !== collection) return null
    if (from === '') return { collection: toCollection, path: item.path }
    if (item.path === from) return { collection: toCollection, path: to }
    if (item.path.startsWith(`${from}/`)) return { collection: toCollection, path: to + item.path.slice(from.length) }
    return null
  }
  useApp.setState((s) => {
    let activeTabId = s.activeTabId
    const tabs = s.tabs.map((tab) => {
      const target = moved(tab)
      if (!target) return tab
      const id = tabId(tab.kind, target.collection, target.path)
      if (activeTabId === tab.id) activeTabId = id
      return { ...tab, id, ...target }
    })
    return { tabs, activeTabId }
  })
  updatePins((pins) => (pins.some((pin) => moved(pin)) ? pins.map((pin) => moved(pin) ?? pin) : pins))
}

export function closeAllTabs(): void {
  clearDrafts()
  useApp.setState({ tabs: [], activeTabId: null })
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
