// Settings of a folder: what its requests inherit.
import { useQueryClient } from '@tanstack/react-query'
import { Folder as FolderIcon, Save } from 'lucide-react'
import { useState } from 'react'
import type { Folder } from '@core/model'
import { api } from '../../lib/bridge'
import { useDraft } from '../../lib/useDraft'
import { PanelTabs } from '../../components/PanelTabs'
import { Button, ErrorBox, Spinner } from '../../components/ui'
import { retargetTabs, tabId } from '../../store'
import { definedNames, VariableScopeProvider } from '../../components/variables'
import { SettingsPanel, settingsTabs, type SettingsTab } from './SettingsPanels'
import { parentOf, useRefreshContent } from './useCollections'

export function FolderView({ collection, path }: { collection: string; path: string }) {
  const refresh = useRefreshContent()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<SettingsTab>('headers')
  const { draft, setDraft, dirty, saving, save, error } = useDraft<Folder>({
    queryKey: ['folder', collection, path],
    load: () => api.collections.getFolder({ collection, path }),
    tabId: tabId('folder', collection, path),
    describe: (folder) => ({ kind: 'Folder', title: folder.name, location: `${collection} / ${path}` }),
    save: async (data) => {
      const saved = await api.collections.saveFolder({ collection, parent: parentOf(path), path, data })
      if (saved !== path) retargetTabs(collection, path, saved)
      queryClient.setQueryData(['folder', collection, saved], data)
      await refresh()
    }
  })

  if (error) return <ErrorBox>{String(error)}</ErrorBox>
  if (!draft) return <Spinner className="m-4" />

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FolderIcon className="size-4 text-muted" />
        <input
          aria-label="Folder name"
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-1 text-base font-semibold outline-none focus:bg-panel-2"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Button
          variant={dirty ? 'primary' : 'secondary'}
          size="sm"
          icon={<Save className="size-3.5" />}
          loading={saving}
          disabled={!dirty}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      <PanelTabs tabs={settingsTabs(draft)} value={tab} onChange={setTab} />
      <div className="min-h-0 flex-1">
        <VariableScopeProvider collection={collection} folder={path} extra={definedNames(draft.vars)}>
          <SettingsPanel
            tab={tab}
            value={draft}
            onChange={setDraft}
            scope={`folder/${collection}/${path}`}
            collection={collection}
            allowInherit
          />
        </VariableScopeProvider>
      </div>
    </div>
  )
}
