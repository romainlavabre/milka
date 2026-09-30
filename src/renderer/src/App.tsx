// Application shell: sidebar (workspace, collections) and main area.
import * as RadixTooltip from '@radix-ui/react-tooltip'
import { FolderGit2 } from 'lucide-react'
import { useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { DialogHost, Toaster } from './components/feedback'
import { Button, EmptyState } from './components/ui'
import { CollectionTree } from './features/collections/CollectionTree'
import { MainArea } from './features/layout/MainArea'
import { AddWorkspaceDialog } from './features/workspace/AddWorkspaceDialog'
import { WorkspaceSwitcher } from './features/workspace/WorkspaceSwitcher'
import { useActiveRepo, useWorkspaceStatus } from './features/workspace/useWorkspace'

export function App() {
  useWorkspaceStatus()
  const repo = useActiveRepo()

  return (
    <RadixTooltip.Provider>
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize="22" minSize={240} maxSize="45">
          <aside className="flex h-full flex-col bg-panel">
            <WorkspaceSwitcher />
            {repo && <CollectionTree />}
          </aside>
        </Panel>
        <Separator className="resize-handle w-px" />
        <Panel minSize="40">
          <main className="h-full min-w-0">{repo ? <MainArea /> : <Welcome />}</main>
        </Panel>
      </Group>
      <Toaster />
      <DialogHost />
    </RadixTooltip.Provider>
  )
}

function Welcome() {
  const [adding, setAdding] = useState(false)
  return (
    <EmptyState icon={<FolderGit2 className="size-10" />} title="Welcome to Milka">
      <p className="max-w-md text-xs leading-relaxed">
        Create a workspace to start, or clone the git repository your team shares. Each workspace is its own git repository.
      </p>
      <Button variant="primary" onClick={() => setAdding(true)}>
        Add workspace
      </Button>
      <AddWorkspaceDialog open={adding} onOpenChange={setAdding} />
    </EmptyState>
  )
}
