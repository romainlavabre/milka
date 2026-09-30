// Bodies of a request: a request keeps several payload variants (valid,
// missing field, edge case…); the selected one is sent.
import * as Menu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Copy, FileJson, FolderOpen, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { BODY_TYPES, activeBody, newBody, type Body, type BodyType, type FormField, type HttpRequest } from '@core/model'
import { api } from '../../lib/bridge'
import { confirm, prompt, toast } from '../../components/feedback'
import { CodeEditor, type CodeLanguage } from '../../components/CodeEditor'
import { KeyValueTable, keyValue } from '../../components/KeyValueTable'
import { Button, EmptyState, IconButton, Input, Select } from '../../components/ui'
import { menuContentClass, menuItemClass } from '../workspace/WorkspaceSwitcher'

const TYPE_LABELS: Record<BodyType, string> = {
  none: 'No body',
  json: 'JSON',
  xml: 'XML',
  text: 'Text',
  form: 'Form URL encoded',
  multipart: 'Multipart form',
  graphql: 'GraphQL',
  binary: 'File'
}

const LANGUAGES: Partial<Record<BodyType, CodeLanguage>> = { json: 'json', xml: 'xml', text: 'plaintext', graphql: 'graphql' }

function uniqueName(request: HttpRequest, base: string): string {
  const taken = new Set(request.bodies.map((b) => b.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`
}

export function BodyPanel({ request, onChange }: { request: HttpRequest; onChange: (request: HttpRequest) => void }) {
  const body = activeBody(request)

  const setBody = (patch: Partial<Body>): void => {
    if (!body) return
    onChange({ ...request, bodies: request.bodies.map((b) => (b.name === body.name ? { ...b, ...patch } : b)) })
  }

  const add = async (from?: Body): Promise<void> => {
    const name = await prompt({
      title: from ? 'Duplicate body' : 'New body',
      label: 'Name of this payload variant (e.g. "Valid user", "Missing email")',
      initial: from ? uniqueName(request, `${from.name} copy`) : uniqueName(request, request.bodies.length ? 'Body' : 'Default'),
      confirmLabel: from ? 'Duplicate' : 'Add'
    })
    if (!name?.trim()) return
    if (request.bodies.some((b) => b.name === name.trim())) {
      toast(`A body named "${name.trim()}" already exists`, 'warning')
      return
    }
    const created = from ? { ...from, name: name.trim() } : newBody(name.trim(), body?.type && body.type !== 'none' ? body.type : 'json')
    onChange({ ...request, bodies: [...request.bodies, created], activeBody: created.name })
  }

  const rename = async (): Promise<void> => {
    if (!body) return
    const name = await prompt({ title: 'Rename body', label: 'Name', initial: body.name, confirmLabel: 'Rename' })
    if (!name?.trim() || name.trim() === body.name) return
    if (request.bodies.some((b) => b.name === name.trim())) {
      toast(`A body named "${name.trim()}" already exists`, 'warning')
      return
    }
    onChange({
      ...request,
      bodies: request.bodies.map((b) => (b.name === body.name ? { ...b, name: name.trim() } : b)),
      activeBody: name.trim()
    })
  }

  const remove = async (): Promise<void> => {
    if (!body) return
    const ok = await confirm({
      title: `Delete body "${body.name}"`,
      body: 'This payload variant is removed from the request.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    const bodies = request.bodies.filter((b) => b.name !== body.name)
    onChange({ ...request, bodies, activeBody: bodies[0]?.name ?? null })
  }

  if (!body) {
    return (
      <EmptyState icon={<FileJson className="size-8" />} title="No body">
        <p className="max-w-sm text-xs">A request can hold several bodies — one per payload variant — and you pick the one to send.</p>
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void add()}>
          Add body
        </Button>
      </EmptyState>
    )
  }

  const format = (): void => {
    try {
      setBody({ content: JSON.stringify(JSON.parse(body.content), null, 2) })
    } catch {
      toast('The body is not valid JSON (variables must be inside quotes to format it)', 'warning')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Menu.Root>
          <Menu.Trigger
            className="flex h-7 max-w-64 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-xs outline-none hover:bg-hover"
            aria-label="Select body"
          >
            <span className="truncate font-medium">{body.name}</span>
            {request.bodies.length > 1 && <span className="text-muted">({request.bodies.length})</span>}
            <ChevronDown className="size-3.5 shrink-0 text-muted" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="start" sideOffset={4} className={menuContentClass}>
              <Menu.Label className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Bodies — the selected one is sent
              </Menu.Label>
              <Menu.RadioGroup value={body.name} onValueChange={(name) => onChange({ ...request, activeBody: name })}>
                {request.bodies.map((b) => (
                  <Menu.RadioItem key={b.name} value={b.name} className={menuItemClass}>
                    <span className={b.name === body.name ? 'size-1.5 rounded-full bg-accent' : 'size-1.5'} />
                    <span className="flex-1 truncate">{b.name}</span>
                    <span className="text-[10px] text-muted">{TYPE_LABELS[b.type]}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={menuItemClass} onSelect={() => void add()}>
                <Plus className="size-3.5" /> New body
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
        <IconButton label="Rename body" onClick={() => void rename()}>
          <Pencil className="size-3.5" />
        </IconButton>
        <IconButton label="Duplicate body" onClick={() => void add(body)}>
          <Copy className="size-3.5" />
        </IconButton>
        <IconButton label="Delete body" onClick={() => void remove()}>
          <Trash2 className="size-3.5" />
        </IconButton>
        <div className="flex-1" />
        {body.type === 'json' && (
          <Button size="sm" variant="ghost" icon={<Wand2 className="size-3.5" />} onClick={format}>
            Format
          </Button>
        )}
        <Select
          aria-label="Body type"
          className="h-7 w-44 text-xs"
          value={body.type}
          onChange={(e) => setBody({ type: e.target.value as BodyType })}
        >
          {BODY_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-h-0 flex-1">
        <BodyContent body={body} setBody={setBody} />
      </div>
    </div>
  )
}

function BodyContent({ body, setBody }: { body: Body; setBody: (patch: Partial<Body>) => void }) {
  switch (body.type) {
    case 'none':
      return <EmptyState title="This variant sends no body" />
    case 'form':
    case 'multipart':
      return (
        <div className="h-full overflow-auto p-3">
          <KeyValueTable<FormField>
            rows={body.fields}
            onChange={(fields) => setBody({ fields })}
            create={(patch) => ({ ...keyValue(patch), type: 'text' })}
            namePlaceholder="Field"
            extra={
              body.type === 'multipart'
                ? (row, update) => (
                    <select
                      className="h-7 w-full bg-transparent text-xs outline-none"
                      value={row.type}
                      onChange={(e) => update({ type: e.target.value as FormField['type'] })}
                    >
                      <option value="text">Text</option>
                      <option value="file">File</option>
                    </select>
                  )
                : undefined
            }
            valueCell={
              body.type === 'multipart'
                ? (row, update) =>
                    row.type === 'file' ? (
                      <FilePicker value={row.value} onChange={(value) => update({ value })} compact />
                    ) : (
                      <input
                        className="h-7 w-full bg-transparent px-2 font-mono text-xs outline-none focus:bg-panel-2"
                        value={row.value}
                        placeholder="Value"
                        onChange={(e) => update({ value: e.target.value })}
                      />
                    )
                : undefined
            }
          />
        </div>
      )
    case 'binary':
      return (
        <div className="p-3">
          <FilePicker value={body.content} onChange={(content) => setBody({ content })} />
          <p className="mt-2 text-[11px] text-muted">
            Paths relative to the workspace folder are shared with your team; absolute paths only work on your machine.
          </p>
        </div>
      )
    case 'graphql':
      return (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-[2]">
            <CodeEditor language="graphql" value={body.content} onChange={(content) => setBody({ content })} placeholder="query { … }" />
          </div>
          <div className="border-y border-border px-3 py-1 text-[11px] text-muted">Variables (JSON)</div>
          <div className="min-h-0 flex-1">
            <CodeEditor language="json" value={body.variables} onChange={(variables) => setBody({ variables })} />
          </div>
        </div>
      )
    default:
      return <CodeEditor language={LANGUAGES[body.type] ?? 'plaintext'} value={body.content} onChange={(content) => setBody({ content })} />
  }
}

function FilePicker({ value, onChange, compact }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const browse = async (): Promise<void> => {
    const file = await api.dialog.openFile({ title: 'Choose a file' })
    if (file) onChange(file)
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        className={compact ? 'h-7 border-0 bg-transparent text-xs' : ''}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="path/to/file"
      />
      <IconButton label="Browse" onClick={() => void browse()}>
        <FolderOpen className="size-3.5" />
      </IconButton>
    </div>
  )
}
