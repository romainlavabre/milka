// Authentication settings of a request, folder or collection.
import type { Auth, AuthType } from '@core/model'
import { Field, Input, Select } from './ui'
import { VariableInput } from './variables'

const LABELS: Record<AuthType, string> = {
  inherit: 'Inherit from parent',
  none: 'No auth',
  basic: 'Basic auth',
  bearer: 'Bearer token',
  apikey: 'API key'
}

export function AuthEditor({ auth, onChange, allowInherit }: { auth: Auth; onChange: (auth: Auth) => void; allowInherit: boolean }) {
  const set = (patch: Partial<Auth>): void => onChange({ ...auth, ...patch })
  const types = (Object.keys(LABELS) as AuthType[]).filter((t) => allowInherit || t !== 'inherit')

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <Field label="Type">
        <Select value={auth.type} onChange={(e) => set({ type: e.target.value as AuthType })}>
          {types.map((type) => (
            <option key={type} value={type}>
              {LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>
      {auth.type === 'inherit' && <p className="text-xs text-muted">Uses the auth of the parent folder, or of the collection.</p>}
      {auth.type === 'basic' && (
        <>
          <Field label="Username">
            <VariableInput value={auth.username} onChange={(e) => set({ username: e.target.value })} placeholder="{{username}}" />
          </Field>
          <Field label="Password" hint="Use a secret variable, e.g. {{password}}, to keep it out of the repository.">
            <VariableInput value={auth.password} onChange={(e) => set({ password: e.target.value })} placeholder="{{password}}" />
          </Field>
        </>
      )}
      {auth.type === 'bearer' && (
        <Field label="Token" hint="Use a secret variable, e.g. {{token}}, to keep it out of the repository.">
          <VariableInput value={auth.token} onChange={(e) => set({ token: e.target.value })} placeholder="{{token}}" />
        </Field>
      )}
      {auth.type === 'apikey' && (
        <>
          <Field label="Key">
            <Input value={auth.key} onChange={(e) => set({ key: e.target.value })} placeholder="X-API-Key" />
          </Field>
          <Field label="Value">
            <VariableInput value={auth.value} onChange={(e) => set({ value: e.target.value })} placeholder="{{apiKey}}" />
          </Field>
          <Field label="Add to">
            <Select value={auth.in} onChange={(e) => set({ in: e.target.value as 'header' | 'query' })}>
              <option value="header">Header</option>
              <option value="query">Query parameter</option>
            </Select>
          </Field>
        </>
      )}
    </div>
  )
}
