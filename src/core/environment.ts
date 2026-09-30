// Values of an environment: shared variables plus the secret values given by
// the caller (local secret store in the app, CLI options or process
// environment in CI).
import type { WorkspaceStore } from './layout/store'
import type { EnvironmentValues } from './engine'
import { enabledVars } from './vars'

/** Prefix of process variables providing secret values in CI: MILKA_SECRET_TOKEN for `token`. */
export const SECRET_ENV_PREFIX = 'MILKA_SECRET_'

export function environmentValues(
  store: WorkspaceStore,
  collection: string,
  env: string | null,
  secretValues: Record<string, string>
): EnvironmentValues {
  if (!env) return { name: null, vars: {} }
  const environment = store.readEnvironment(collection, env)
  const vars = enabledVars(environment.vars)
  for (const name of environment.secrets) if (secretValues[name] !== undefined) vars[name] = secretValues[name]
  return { name: environment.name, vars }
}

/** Secret values read from MILKA_SECRET_<NAME> process variables (names are matched case-insensitively). */
export function secretsFromProcessEnv(names: string[], processEnv: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const key = SECRET_ENV_PREFIX + name.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
    if (processEnv[key] !== undefined) out[name] = processEnv[key]!
  }
  return out
}
