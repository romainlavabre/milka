// Tab bar and content of the open tabs.
import clsx from 'clsx'
import { FileText, Folder as FolderIcon, Layers, Play, X } from 'lucide-react'
import { useShortcut } from '../../lib/shortcuts'
import { EmptyState } from '../../components/ui'
import { closeTab, useApp, type Tab } from '../../store'
import { findNode, methodColor, useCollections } from '../collections/useCollections'
import { CollectionView } from '../collections/CollectionView'
import { FolderView } from '../collections/FolderView'
import { RequestView } from '../request/RequestView'
import { RunnerView } from '../runner/RunnerView'

export function MainArea() {
  const tabs = useApp((s) => s.tabs)
  const activeTabId = useApp((s) => s.activeTabId)
  const active = tabs.find((t) => t.id === activeTabId) ?? null

  useShortcut('w', () => activeTabId && closeTab(activeTabId))

  return (
    <div className="flex h-full min-w-0 flex-col">
      {tabs.length > 0 && (
        <div className="no-scrollbar flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b border-border bg-panel">
          {tabs.map((tab) => (
            <TabButton key={tab.id} tab={tab} active={tab.id === activeTabId} />
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {active ? (
          <TabContent key={active.id} tab={active} />
        ) : (
          <EmptyState icon={<Layers className="size-10" />} title="No request open">
            <p className="text-xs">Pick a request in the sidebar, or create one from a collection's menu.</p>
          </EmptyState>
        )}
      </div>
    </div>
  )
}

function TabContent({ tab }: { tab: Tab }) {
  switch (tab.kind) {
    case 'request':
      return <RequestView collection={tab.collection} path={tab.path} />
    case 'collection':
      return <CollectionView collection={tab.collection} />
    case 'folder':
      return <FolderView collection={tab.collection} path={tab.path} />
    case 'runner':
      return <RunnerView collection={tab.collection} path={tab.path} />
  }
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const { data: collections } = useCollections()
  const collection = collections?.find((c) => c.slug === tab.collection)
  const node = tab.path ? findNode(collection?.children ?? [], tab.path) : undefined
  // A tab is dirty when its editor, or one of its sub-editors (`<id>#…`), has unsaved changes.
  const dirty = useApp((s) => Object.entries(s.dirty).some(([key, value]) => value && (key === tab.id || key.startsWith(`${tab.id}#`))))

  let icon = <FileText className="size-3.5 text-muted" />
  let title = node?.name ?? tab.path
  if (tab.kind === 'request' && node?.kind === 'request') {
    icon = (
      <span className="font-mono text-[10px] font-bold" style={{ color: methodColor(node.method) }}>
        {node.method}
      </span>
    )
  } else if (tab.kind === 'collection') {
    icon = <Layers className="size-3.5 text-muted" />
    title = collection?.name ?? tab.collection
  } else if (tab.kind === 'folder') {
    icon = <FolderIcon className="size-3.5 text-muted" />
  } else if (tab.kind === 'runner') {
    icon = <Play className="size-3.5 text-muted" />
    title = `Run ${node?.name ?? collection?.name ?? tab.collection}`
  }

  return (
    <div
      className={clsx(
        'group flex h-full max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-t-2 px-3 text-xs',
        active ? 'bg-bg text-fg' : 'border-transparent text-muted hover:bg-hover'
      )}
      style={active ? { borderTopColor: collection?.color ?? 'var(--accent)' } : undefined}
      onClick={() => useApp.setState({ activeTabId: tab.id })}
      onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
      title={`${collection?.name ?? tab.collection}${tab.path ? ` / ${tab.path}` : ''}`}
    >
      {!active && collection && <span className="size-1.5 shrink-0 rounded-full" style={{ background: collection.color }} />}
      {icon}
      <span className="truncate">{title}</span>
      <button
        className="ml-1 rounded p-0.5 opacity-60 hover:bg-hover hover:opacity-100"
        aria-label="Close tab"
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tab.id)
        }}
      >
        {dirty ? <span className="block size-2 rounded-full bg-fg group-hover:hidden" /> : null}
        <X className={clsx('size-3', dirty && 'hidden group-hover:block')} />
      </button>
    </div>
  )
}
