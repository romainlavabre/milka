// Local app settings, never shared.
import type { AppSettings } from '@shared/types'
import { JsonStore } from './jsonStore'

export const DEFAULT_SETTINGS: AppSettings = { insecureTls: false }

export class SettingsStore extends JsonStore<AppSettings> {
  constructor(filePath: string) {
    super(filePath, () => ({ ...DEFAULT_SETTINGS }))
  }
}
