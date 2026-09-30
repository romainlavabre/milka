// Imports a Bruno collection, a Postman collection, an OpenAPI document or a cURL command.
import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/bridge'
import { toast } from '../../components/feedback'
import { Button, Dialog, ErrorBox, Field, IconButton, Input, SegmentedControl, Select, Textarea } from '../../components/ui'
import { openTab } from '../../store'
import { useCollections, useRefreshContent } from './useCollections'

type Source = 'bruno' | 'postman' | 'openapi' | 'curl'

const HINTS: Record<Source, string> = {
  bruno:
    'The folder of a Bruno collection (with its bruno.json, or its opencollection.yml for the YAML format of Bruno 3). Folders, requests, environments, assertions and scripts are carried over; scripts are converted to the Milka API where possible.',
  postman: 'A Postman collection exported as v2.1 JSON. The request bodies of saved examples become extra bodies of the request.',
  openapi:
    'An OpenAPI 3 document, YAML or JSON. One request per operation, grouped by tag; named examples become bodies, servers become environments.',
  curl: 'Paste a cURL command, e.g. from "Copy as cURL" in the browser dev tools.'
}

export function ImportDialog({
  open,
  onOpenChange,
  initial = 'bruno',
  collection
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: Source
  collection?: string
}) {
  const refresh = useRefreshContent()
  const { data: collections } = useCollections()
  const [source, setSource] = useState<Source>(initial)
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSource(initial)
    setPath('')
    setText('')
    setError(null)
    setTarget(collection ?? '')
  }, [open, initial, collection])

  useEffect(() => {
    if (!target && collections?.length) setTarget(collections[0].slug)
  }, [collections, target])

  const browse = async (): Promise<void> => {
    const picked =
      source === 'bruno'
        ? await api.dialog.openDirectory({ title: 'Bruno collection folder' })
        : await api.dialog.openFile({
            title: source === 'postman' ? 'Postman collection' : 'OpenAPI document',
            filters:
              source === 'postman'
                ? [{ name: 'Postman collection', extensions: ['json'] }]
                : [{ name: 'OpenAPI', extensions: ['yaml', 'yml', 'json'] }]
          })
    if (picked) setPath(picked)
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (source === 'curl') {
        const created = await api.importer.curl({ collection: target, parent: '', command: text })
        await refresh()
        openTab('request', target, created)
        toast('Request created from the cURL command', 'success')
      } else {
        const result = await api.importer.collection({ format: source, ...(path ? { path } : { text }) })
        await refresh()
        openTab('collection', result.slug)
        toast(`Imported ${result.requests} request${result.requests === 1 ? '' : 's'}`, 'success')
        for (const warning of result.warnings) toast(warning, 'warning')
      }
      onOpenChange(false)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const valid = source === 'curl' ? !!text.trim() && !!target : source === 'bruno' ? !!path : !!path || !!text.trim()

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import"
      width={620}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl<Source>
          value={source}
          onChange={(value) => {
            setSource(value)
            setPath('')
            setError(null)
          }}
          options={[
            { value: 'bruno', label: 'Bruno' },
            { value: 'postman', label: 'Postman' },
            { value: 'openapi', label: 'OpenAPI' },
            { value: 'curl', label: 'cURL' }
          ]}
        />
        <p className="text-xs leading-relaxed text-muted">{HINTS[source]}</p>
        {source === 'curl' ? (
          <>
            <Field label="Into collection">
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                {collections?.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Command">
              <Textarea
                rows={8}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="curl 'https://api.example.com/users' -H 'Accept: application/json'"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={source === 'bruno' ? 'Folder' : 'File'}>
              <div className="flex gap-1">
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={source === 'bruno' ? '/path/to/bruno-collection' : '/path/to/file'}
                />
                <IconButton label="Browse" onClick={() => void browse()} className="h-8 w-8 border border-border">
                  <FolderOpen className="size-4" />
                </IconButton>
              </div>
            </Field>
            {source === 'openapi' && !path && (
              <Field label="…or paste the document">
                <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="openapi: 3.0.3" />
              </Field>
            )}
          </>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Dialog>
  )
}
