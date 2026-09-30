// Sidebar tree of the collections of the active workspace: folders and
// requests, context menus, colors and drag and drop reordering.
import * as ContextMenu from '@radix-ui/react-context-menu'
import clsx from 'clsx'
import {
  ChevronRight,
  Copy,
  Download,
  FilePlus,
  Folder as FolderIcon,
  FolderPlus,
  Palette,
  Pencil,
  Play,
  Plus,
  Settings,
  Terminal,
  Trash2,
  Upload
} from 'lucide-react'
import { useState, type DragEvent, type ReactNode } from 'react'
import { COLLECTION_COLORS, newCollection, newFolder, newRequest, type CollectionSummary, type TreeNode } from '@core/model'
import { api, errorMessage } from '../../lib/bridge'
import { confirm, prompt, toast } from '../../components/feedback'
import { EmptyState, IconButton } from '../../components/ui'
import { closeTabsUnder, openTab, retargetTabs, tabId, useApp } from '../../store'
import { askUnsaved, draftsUnder } from '../layout/UnsavedChanges'
import { menuContentClass, menuItemClass } from '../workspace/WorkspaceSwitcher'
import { ImportDialog } from './ImportDialog'
import { methodColor, parentOf, useCollections, useRefreshContent } from './useCollections'

const DRAG_TYPE = 'application/x-milka-node'

interface DragData {
  collection: string
  path: string
}

function useActions() {
  const refresh = useRefreshContent()
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await action()
      await refresh()
      return result
    } catch (error) {
      toast(errorMessage(error), 'error')
      return undefined
    }
  }

  return {
    run,
    async newCollection(): Promise<void> {
      const name = await prompt({ title: 'New collection', label: 'Name', confirmLabel: 'Create' })
      if (!name?.trim()) return
      const slug = await run(() => api.collections.save({ collection: null, data: newCollection(name.trim()) }))
      if (slug) openTab('collection', slug)
    },
    async newRequest(collection: string, parent: string, onCreated?: () => void): Promise<void> {
      const name = await prompt({ title: 'New request', label: 'Name', confirmLabel: 'Create' })
      if (!name?.trim()) return
      const path = await run(() => api.collections.saveRequest({ collection, parent, path: null, data: newRequest(name.trim()) }))
      if (path) {
        onCreated?.()
        openTab('request', collection, path)
      }
    },
    async newFolder(collection: string, parent: string, onCreated?: () => void): Promise<void> {
      const name = await prompt({ title: 'New folder', label: 'Name', confirmLabel: 'Create' })
      if (!name?.trim()) return
      if (await run(() => api.collections.saveFolder({ collection, parent, path: null, data: newFolder(name.trim()) }))) onCreated?.()
    }
  }
}

export function CollectionTree() {
  const { data: collections, isLoading } = useCollections()
  const actions = useActions()
  const [importing, setImporting] = useState(false)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-0.5 px-3 pb-1 pt-2">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Collections</span>
        <IconButton label="Import (Bruno, Postman, OpenAPI, cURL)" onClick={() => setImporting(true)}>
          <Download className="size-4" />
        </IconButton>
        <IconButton label="New collection" onClick={() => void actions.newCollection()}>
          <Plus className="size-4" />
        </IconButton>
        <ImportDialog open={importing} onOpenChange={setImporting} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-4">
        {collections?.map((collection) => (
          <CollectionRow key={collection.slug} collection={collection} />
        ))}
        {!isLoading && collections?.length === 0 && (
          <EmptyState title="No collection yet">
            <button className="text-xs text-accent hover:underline" onClick={() => void actions.newCollection()}>
              Create a collection
            </button>
          </EmptyState>
        )}
      </div>
    </div>
  )
}

function CollectionRow({ collection }: { collection: CollectionSummary }) {
  const [open, setOpen] = useState(true)
  const actions = useActions()
  const [dropping, setDropping] = useState(false)
  const [importingCurl, setImportingCurl] = useState(false)

  const exportOpenApi = async (): Promise<void> => {
    const file = await api.dialog.saveFile({
      title: 'Export as OpenAPI',
      defaultName: `${collection.slug}.openapi.yaml`,
      filters: [{ name: 'OpenAPI', extensions: ['yaml', 'yml', 'json'] }]
    })
    if (!file) return
    try {
      await api.exporter.openapi({ collection: collection.slug, file })
      toast(`OpenAPI document written to ${file}`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const setColor = (color: string): Promise<unknown> =>
    actions.run(async () =>
      api.collections.save({
        collection: collection.slug,
        data: { ...(await api.collections.get({ collection: collection.slug })), color }
      })
    )

  const rename = async (): Promise<void> => {
    const name = await prompt({ title: 'Rename collection', label: 'Name', initial: collection.name, confirmLabel: 'Rename' })
    if (!name?.trim() || name.trim() === collection.name) return
    // Renaming moves the files: pending changes are saved or dropped first.
    if (!(await askUnsaved(draftsUnder(collection.slug), 'Rename'))) return
    const slug = await actions.run(async () =>
      api.collections.save({
        collection: collection.slug,
        data: { ...(await api.collections.get({ collection: collection.slug })), name: name.trim() }
      })
    )
    if (slug && slug !== collection.slug) retargetTabs(collection.slug, '', '', slug)
  }

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete collection "${collection.name}"`,
      body: 'Its folders, requests and environments are deleted, and the change is committed to the workspace.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    closeTabsUnder(collection.slug)
    await actions.run(() => api.collections.remove({ collection: collection.slug }))
  }

  return (
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            className={clsx('group flex h-7 cursor-pointer items-center gap-1.5 rounded px-1.5 hover:bg-hover', dropping && 'bg-accent/20')}
            onClick={() => setOpen(!open)}
            onDoubleClick={() => openTab('collection', collection.slug)}
            {...dropHandlers(collection.slug, '', null, setDropping, actions.run)}
          >
            <ChevronRight className={clsx('size-3.5 shrink-0 text-muted transition', open && 'rotate-90')} />
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: collection.color }} />
            <span className="min-w-0 flex-1 truncate font-medium">{collection.name}</span>
            <IconButton
              label="Collection settings"
              className="size-6 opacity-0 group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                openTab('collection', collection.slug)
              }}
            >
              <Settings className="size-3.5" />
            </IconButton>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContentClass}>
            <MenuItem
              icon={<FilePlus className="size-3.5" />}
              onSelect={() => void actions.newRequest(collection.slug, '', () => setOpen(true))}
            >
              New request
            </MenuItem>
            <MenuItem
              icon={<FolderPlus className="size-3.5" />}
              onSelect={() => void actions.newFolder(collection.slug, '', () => setOpen(true))}
            >
              New folder
            </MenuItem>
            <MenuItem icon={<Terminal className="size-3.5" />} onSelect={() => setImportingCurl(true)}>
              New request from cURL
            </MenuItem>
            <MenuItem icon={<Play className="size-3.5" />} onSelect={() => openTab('runner', collection.slug)}>
              Run collection
            </MenuItem>
            <MenuItem icon={<Upload className="size-3.5" />} onSelect={() => void exportOpenApi()}>
              Export as OpenAPI…
            </MenuItem>
            <ContextMenu.Separator className="my-1 h-px bg-border" />
            <MenuItem icon={<Settings className="size-3.5" />} onSelect={() => openTab('collection', collection.slug)}>
              Settings & environments
            </MenuItem>
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={menuItemClass}>
                <Palette className="size-3.5" /> Color
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={clsx(menuContentClass, 'grid min-w-0 grid-cols-5 gap-1.5 p-2')}>
                  {COLLECTION_COLORS.map((color) => (
                    <ContextMenu.Item
                      key={color}
                      aria-label={`Color ${color}`}
                      className={clsx(
                        'size-6 cursor-pointer rounded-full outline-none ring-offset-2 ring-offset-panel-2 data-[highlighted]:ring-2 data-[highlighted]:ring-muted',
                        collection.color === color && 'ring-2 ring-fg'
                      )}
                      style={{ background: color }}
                      onSelect={() => void setColor(color)}
                    />
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => void rename()}>
              Rename
            </MenuItem>
            <ContextMenu.Separator className="my-1 h-px bg-border" />
            <MenuItem danger icon={<Trash2 className="size-3.5" />} onSelect={() => void remove()}>
              Delete
            </MenuItem>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <ImportDialog open={importingCurl} onOpenChange={setImportingCurl} initial="curl" collection={collection.slug} />
      {open && (
        <div className="ml-2 border-l border-border/60 pl-1">
          {collection.children.map((node) => (
            <NodeRow key={node.path} collection={collection} node={node} />
          ))}
        </div>
      )}
    </div>
  )
}

function NodeRow({ collection, node }: { collection: CollectionSummary; node: TreeNode }) {
  const [open, setOpen] = useState(false)
  const [dropping, setDropping] = useState(false)
  const actions = useActions()
  const activeTabId = useApp((s) => s.activeTabId)
  const slug = collection.slug
  const isActive = node.kind === 'request' && activeTabId === tabId('request', slug, node.path)

  const rename = async (): Promise<void> => {
    const name = await prompt({ title: `Rename ${node.kind}`, label: 'Name', initial: node.name, confirmLabel: 'Rename' })
    if (!name?.trim() || name.trim() === node.name) return
    if (!(await askUnsaved(draftsUnder(slug, node.path), 'Rename'))) return
    const parent = parentOf(node.path)
    const path = await actions.run(async () =>
      node.kind === 'request'
        ? api.collections.saveRequest({
            collection: slug,
            parent,
            path: node.path,
            data: { ...(await api.collections.getRequest({ collection: slug, path: node.path })), name: name.trim() }
          })
        : api.collections.saveFolder({
            collection: slug,
            parent,
            path: node.path,
            data: { ...(await api.collections.getFolder({ collection: slug, path: node.path })), name: name.trim() }
          })
    )
    if (path && path !== node.path) retargetTabs(slug, node.path, path)
  }

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete ${node.kind} "${node.name}"`,
      body: node.kind === 'folder' ? 'The folder and every request inside it are deleted.' : 'The request and all its bodies are deleted.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    closeTabsUnder(slug, node.path)
    await actions.run(() =>
      node.kind === 'request'
        ? api.collections.removeRequest({ collection: slug, path: node.path })
        : api.collections.removeFolder({ collection: slug, path: node.path })
    )
  }

  const row = (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ collection: slug, path: node.path } satisfies DragData))
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={clsx(
        'group flex h-7 cursor-pointer items-center gap-1.5 rounded px-1.5 hover:bg-hover',
        isActive && 'bg-hover text-fg',
        dropping && 'bg-accent/20'
      )}
      onClick={() => (node.kind === 'folder' ? setOpen(!open) : openTab('request', slug, node.path))}
      onDoubleClick={() => node.kind === 'folder' && openTab('folder', slug, node.path)}
      {...(node.kind === 'folder'
        ? dropHandlers(slug, node.path, null, setDropping, actions.run, () => setOpen(true))
        : dropHandlers(slug, parentOf(node.path), node.path, setDropping, actions.run))}
    >
      {node.kind === 'folder' ? (
        <>
          <ChevronRight className={clsx('size-3.5 shrink-0 text-muted transition', open && 'rotate-90')} />
          <FolderIcon className="size-3.5 shrink-0 text-muted" />
        </>
      ) : (
        <span className="w-10 shrink-0 text-right font-mono text-[10px] font-bold" style={{ color: methodColor(node.method) }}>
          {node.method.length > 6 ? node.method.slice(0, 5) : node.method}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
    </div>
  )

  return (
    <div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className={menuContentClass}>
            {node.kind === 'folder' ? (
              <>
                <MenuItem
                  icon={<FilePlus className="size-3.5" />}
                  onSelect={() => void actions.newRequest(slug, node.path, () => setOpen(true))}
                >
                  New request
                </MenuItem>
                <MenuItem
                  icon={<FolderPlus className="size-3.5" />}
                  onSelect={() => void actions.newFolder(slug, node.path, () => setOpen(true))}
                >
                  New folder
                </MenuItem>
                <MenuItem icon={<Play className="size-3.5" />} onSelect={() => openTab('runner', slug, node.path)}>
                  Run folder
                </MenuItem>
                <MenuItem icon={<Settings className="size-3.5" />} onSelect={() => openTab('folder', slug, node.path)}>
                  Settings
                </MenuItem>
              </>
            ) : (
              <MenuItem
                icon={<Copy className="size-3.5" />}
                onSelect={() =>
                  void actions.run(async () => {
                    const path = await api.collections.duplicateRequest({ collection: slug, path: node.path })
                    openTab('request', slug, path)
                  })
                }
              >
                Duplicate
              </MenuItem>
            )}
            <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => void rename()}>
              Rename
            </MenuItem>
            <ContextMenu.Separator className="my-1 h-px bg-border" />
            <MenuItem danger icon={<Trash2 className="size-3.5" />} onSelect={() => void remove()}>
              Delete
            </MenuItem>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {node.kind === 'folder' && open && (
        <div className="ml-3 border-l border-border/60 pl-1">
          {node.children.map((child) => (
            <NodeRow key={child.path} collection={collection} node={child} />
          ))}
          {node.children.length === 0 && <div className="px-2 py-1 text-[11px] text-muted">Empty folder</div>}
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, children, onSelect, danger }: { icon: ReactNode; children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <ContextMenu.Item className={clsx(menuItemClass, danger && 'text-danger')} onSelect={onSelect}>
      {icon} {children}
    </ContextMenu.Item>
  )
}

/** Drop target placing the dragged node into `parent`, before `before`. */
function dropHandlers(
  collection: string,
  parent: string,
  before: string | null,
  setDropping: (dropping: boolean) => void,
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>,
  onDropped?: () => void
) {
  return {
    onDragOver(e: DragEvent) {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      setDropping(true)
    },
    onDragLeave() {
      setDropping(false)
    },
    onDrop(e: DragEvent) {
      setDropping(false)
      const raw = e.dataTransfer.getData(DRAG_TYPE)
      if (!raw) return
      e.preventDefault()
      e.stopPropagation()
      const data = JSON.parse(raw) as DragData
      if (data.collection !== collection) {
        toast('Requests can only be moved inside their collection', 'warning')
        return
      }
      if (data.path === before || data.path === parent) return
      void run(async () => {
        if (!(await askUnsaved(draftsUnder(collection, data.path), 'Move'))) return
        const path = await api.collections.move({ collection, from: data.path, parent, before })
        if (path !== data.path) retargetTabs(collection, data.path, path)
        onDropped?.()
      })
    }
  }
}
