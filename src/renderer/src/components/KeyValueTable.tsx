// Editable table of name / value rows (params, headers, variables, form fields).
// A blank row at the bottom adds new entries as you type; the grip of a row moves it.
import { Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { KeyValue } from '@core/model'
import { useRowReorder } from './reorder'
import { IconButton } from './ui'
import { VariableInput } from './variables'

export function KeyValueTable<T extends KeyValue>({
  rows,
  onChange,
  create,
  namePlaceholder = 'Name',
  valuePlaceholder = 'Value',
  extra,
  valueCell,
  reorderable = true
}: {
  rows: T[]
  onChange: (rows: T[]) => void
  /** Builds a new row from a first typed name or value. */
  create: (patch: Partial<KeyValue>) => T
  namePlaceholder?: string
  valuePlaceholder?: string
  /** Extra cell before the delete button (type selector, secret toggle…). */
  extra?: (row: T, update: (patch: Partial<T>) => void) => ReactNode
  /** Replaces the value input (e.g. a file picker). */
  valueCell?: (row: T, update: (patch: Partial<T>) => void) => ReactNode
  /** False when the order is not the user's (path params follow the URL). */
  reorderable?: boolean
}) {
  const update = (index: number, patch: Partial<T>): void => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const reorder = useRowReorder(rows, onChange)
  const cell = 'h-7 w-full bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted/60 focus:bg-panel-2'

  return (
    <div className="selectable overflow-hidden rounded-md border border-border">
      <table className="w-full table-fixed border-collapse">
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="group border-b border-border last:border-b-0" {...(reorderable ? reorder.rowProps(index) : {})}>
              {reorderable && <td className="w-5">{reorder.handle(index)}</td>}
              <td className="w-8 border-r border-border align-middle">
                <input
                  type="checkbox"
                  aria-label="Enabled"
                  className="mx-auto block size-3.5 accent-[var(--accent)]"
                  checked={row.enabled}
                  onChange={(e) => update(index, { enabled: e.target.checked } as Partial<T>)}
                />
              </td>
              <td className="border-r border-border">
                <input
                  className={cell}
                  value={row.name}
                  placeholder={namePlaceholder}
                  spellCheck={false}
                  onChange={(e) => update(index, { name: e.target.value } as Partial<T>)}
                />
              </td>
              <td className="border-r border-border">
                {valueCell ? (
                  valueCell(row, (patch) => update(index, patch))
                ) : (
                  <VariableInput
                    bare
                    className={cell}
                    value={row.value}
                    placeholder={valuePlaceholder}
                    spellCheck={false}
                    onChange={(e) => update(index, { value: e.target.value } as Partial<T>)}
                  />
                )}
              </td>
              {extra && <td className="w-28 border-r border-border px-1">{extra(row, (patch) => update(index, patch))}</td>}
              <td className="w-8 text-center">
                <IconButton
                  label="Remove"
                  className="size-6 opacity-0 group-hover:opacity-100"
                  onClick={() => onChange(rows.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
              </td>
            </tr>
          ))}
          <tr>
            {reorderable && <td className="w-5" />}
            <td className="w-8 border-r border-border" />
            <td className="border-r border-border">
              <input
                className={cell}
                value=""
                placeholder={rows.length === 0 ? namePlaceholder : 'Add…'}
                spellCheck={false}
                onChange={(e) => onChange([...rows, create({ name: e.target.value })])}
              />
            </td>
            <td className={extra ? 'border-r border-border' : ''}>
              <input
                className={cell}
                value=""
                placeholder={valuePlaceholder}
                spellCheck={false}
                onChange={(e) => onChange([...rows, create({ value: e.target.value })])}
              />
            </td>
            {extra && <td className="w-28 border-r border-border" />}
            <td className="w-8" />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function keyValue(patch: Partial<KeyValue> = {}): KeyValue {
  return { name: '', value: '', enabled: true, description: '', ...patch }
}
