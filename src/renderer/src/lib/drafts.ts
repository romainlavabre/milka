// Unsaved changes of every editor, kept outside the components: they survive
// switching tabs, and can be saved or discarded from anywhere (closing a tab,
// switching workspace, quitting the app).
import { create } from 'zustand'

export interface DraftEntry {
  /** Editor id: the tab id, or `<tab id>#…` for an editor inside a tab. */
  id: string
  /** Tab the editor belongs to. */
  tabId: string
  /** What is edited, e.g. "Request", "Environment". */
  kind: string
  /** Name of the file as it will be saved. */
  title: string
  /** Where it is, e.g. "users-api / admin/create-user.yaml". */
  location: string
  value: unknown
  /** Writes `value` to the workspace. Works once the editor is closed. */
  save: (value: unknown) => Promise<void>
}

export const useDrafts = create<Record<string, DraftEntry>>(() => ({}))

/** Records unsaved changes, or forgets them when `value` is back to the saved one. */
export function putDraft(entry: DraftEntry, saved: unknown): void {
  if (JSON.stringify(entry.value) === JSON.stringify(saved)) forgetDraft(entry.id)
  else useDrafts.setState({ [entry.id]: entry })
}

export function forgetDraft(id: string): void {
  if (!(id in useDrafts.getState())) return
  useDrafts.setState((drafts) => {
    const next = { ...drafts }
    delete next[id]
    return next
  }, true)
}

export function clearDrafts(): void {
  useDrafts.setState({}, true)
}

/** Saves one draft; it is forgotten only once written. */
export async function saveDraft(id: string): Promise<void> {
  const entry = useDrafts.getState()[id]
  if (!entry) return
  await entry.save(entry.value)
  // Unless edited again while saving.
  if (useDrafts.getState()[id]?.value === entry.value) forgetDraft(id)
}

/** Drafts of a tab and of the editors inside it. */
export function draftsOfTab(tabId: string, drafts = useDrafts.getState()): DraftEntry[] {
  return Object.values(drafts).filter((d) => d.tabId === tabId)
}

export function allDrafts(): DraftEntry[] {
  return Object.values(useDrafts.getState())
}

export function useTabDirty(tabId: string): boolean {
  return useDrafts((drafts) => Object.values(drafts).some((d) => d.tabId === tabId))
}
