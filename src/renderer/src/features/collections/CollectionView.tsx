// Settings of a collection: name, color, environments and what its requests inherit.
import * as Popover from '@radix-ui/react-popover'
import { useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useState } from 'react'
import type { Collection } from '@core/model'
import { api } from '../../lib/bridge'
import { useDraft } from '../../lib/useDraft'
import { ColorPalette } from '../../components/ColorPicker'
import { PanelTabs } from '../../components/PanelTabs'
import { Button, ErrorBox, Spinner } from '../../components/ui'
import { retargetTabs, tabId } from '../../store'
import { EnvironmentsPanel } from '../environments/EnvironmentsPanel'
import { SettingsPanel, settingsTabs, type SettingsTab } from './SettingsPanels'
import { useRefreshContent } from './useCollections'

export function CollectionView({ collection }: { collection: string }) {
  const refresh = useRefreshContent()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<SettingsTab>('environments')
  const { draft, setDraft, dirty, saving, save, error } = useDraft<Collection>({
    queryKey: ['collection', collection],
    load: () => api.collections.get({ collection }),
    tabId: tabId('collection', collection),
    save: async (data) => {
      const slug = await api.collections.save({ collection, data })
      if (slug !== collection) retargetTabs(collection, '', '', slug)
      queryClient.setQueryData(['collection', slug], data)
      await refresh()
    }
  })

  if (error) return <ErrorBox>{String(error)}</ErrorBox>
  if (!draft) return <Spinner className="m-4" />

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Popover.Root>
          <Popover.Trigger
            aria-label="Collection color"
            className="size-5 shrink-0 rounded-full ring-2 ring-border"
            style={{ background: draft.color }}
          />
          <Popover.Portal>
            <Popover.Content sideOffset={6} className="z-50 rounded-md border border-border bg-panel-2 p-1 shadow-xl">
              <ColorPalette value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <input
          aria-label="Collection name"
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
      <PanelTabs tabs={[{ id: 'environments', label: 'Environments' }, ...settingsTabs(draft)]} value={tab} onChange={setTab} />
      <div className="min-h-0 flex-1">
        {tab === 'environments' ? (
          <EnvironmentsPanel collection={collection} />
        ) : (
          <SettingsPanel
            tab={tab}
            value={draft}
            onChange={setDraft}
            scope={`collection/${collection}`}
            collection={collection}
            allowInherit={false}
          />
        )}
      </div>
    </div>
  )
}
