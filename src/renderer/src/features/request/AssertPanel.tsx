// Declarative assertions: `res.status equals 201`, `res.body.id exists`.
import { Trash2 } from 'lucide-react'
import { ASSERT_OPERATORS, type Assertion, type AssertOperator } from '@core/model'
import { OPERATOR_LABELS, UNARY_OPERATORS } from '@core/assert-labels'
import { useRowReorder } from '../../components/reorder'
import { IconButton } from '../../components/ui'

const cell = 'h-7 w-full bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted/60 focus:bg-panel-2'

function valueText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function AssertPanel({ assertions, onChange }: { assertions: Assertion[]; onChange: (assertions: Assertion[]) => void }) {
  const update = (index: number, patch: Partial<Assertion>): void =>
    onChange(assertions.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  const add = (patch: Partial<Assertion>): void => onChange([...assertions, { expr: '', op: 'eq', value: '', enabled: true, ...patch }])
  const reorder = useRowReorder(assertions, onChange)

  return (
    <div className="h-full overflow-auto p-3">
      <p className="mb-2 text-[11px] text-muted">
        Checked after each response. Expressions read the response: <code>res.status</code>, <code>res.body.items[0].id</code>,{' '}
        <code>res.headers['content-type']</code>, <code>res.time</code>.
      </p>
      <div className="selectable overflow-hidden rounded-md border border-border">
        <table className="w-full table-fixed border-collapse">
          <tbody>
            {assertions.map((assertion, index) => (
              <tr key={index} className="group border-b border-border last:border-b-0" {...reorder.rowProps(index)}>
                <td className="w-5">{reorder.handle(index)}</td>
                <td className="w-8 border-r border-border text-center">
                  <input
                    type="checkbox"
                    aria-label="Enabled"
                    className="size-3.5 accent-[var(--accent)]"
                    checked={assertion.enabled}
                    onChange={(e) => update(index, { enabled: e.target.checked })}
                  />
                </td>
                <td className="border-r border-border">
                  <input
                    className={cell}
                    value={assertion.expr}
                    placeholder="res.status"
                    onChange={(e) => update(index, { expr: e.target.value })}
                  />
                </td>
                <td className="w-40 border-r border-border">
                  <select
                    className="h-7 w-full bg-transparent px-1 text-xs outline-none"
                    value={assertion.op}
                    onChange={(e) => update(index, { op: e.target.value as AssertOperator })}
                  >
                    {ASSERT_OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border-r border-border">
                  {!UNARY_OPERATORS.includes(assertion.op) && (
                    <input
                      className={cell}
                      value={valueText(assertion.value)}
                      placeholder={assertion.op === 'isType' ? 'string, number, array…' : '200'}
                      onChange={(e) => update(index, { value: e.target.value })}
                    />
                  )}
                </td>
                <td className="w-8 text-center">
                  <IconButton
                    label="Remove"
                    className="size-6 opacity-0 group-hover:opacity-100"
                    onClick={() => onChange(assertions.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </td>
              </tr>
            ))}
            <tr>
              <td className="w-5" />
              <td className="w-8 border-r border-border" />
              <td className="border-r border-border">
                <input
                  className={cell}
                  value=""
                  placeholder={assertions.length ? 'Add…' : 'res.status'}
                  onChange={(e) => add({ expr: e.target.value })}
                />
              </td>
              <td className="w-40 border-r border-border" />
              <td className="border-r border-border" />
              <td className="w-8" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
