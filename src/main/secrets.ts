// Local secret storage. Secret values of environments never enter the
// workspace repository: they live here, encrypted one scope at a time with a
// cipher provided by the caller (Electron safeStorage in the app, a fake one
// in tests).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { JsonStore } from './jsonStore'

export interface Cipher {
  encrypt(plain: string): string
  decrypt(encrypted: string): string
}

/** Electron safeStorage subset, so the module does not depend on Electron. */
export interface OsEncryption {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * Encrypts with the OS keyring when available. Without one (no secret service
 * running), falls back to AES-256-GCM with a key file readable only by the
 * user: it keeps secrets out of plain sight, not away from someone who can
 * read the user's files. Values are prefixed with the method used.
 */
export function createCipher(os: OsEncryption, keyFile: string): Cipher {
  let fileKey: Buffer | null = null
  const key = (): Buffer => {
    if (!fileKey) {
      if (existsSync(keyFile)) fileKey = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64')
      else {
        mkdirSync(dirname(keyFile), { recursive: true })
        fileKey = randomBytes(32)
        writeFileSync(keyFile, fileKey.toString('base64'), { mode: 0o600 })
      }
    }
    return fileKey
  }
  return {
    encrypt(plain) {
      if (os.isEncryptionAvailable()) return `os:${os.encryptString(plain).toString('base64')}`
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key(), iv)
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return `file:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`
    },
    decrypt(encrypted) {
      if (encrypted.startsWith('file:')) {
        const raw = Buffer.from(encrypted.slice(5), 'base64')
        const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
        decipher.setAuthTag(raw.subarray(12, 28))
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
      }
      return os.decryptString(Buffer.from(encrypted.replace(/^os:/, ''), 'base64'))
    }
  }
}

export type SecretValues = Record<string, string>

interface SecretsFile {
  /** `<repoId>:<scope>` → encrypted JSON of SecretValues. */
  secrets: Record<string, string>
}

/**
 * Secrets grouped by scope inside a workspace. The scope of an environment
 * is `<collection slug>/<environment slug>`.
 */
export class SecretStore {
  private readonly store: JsonStore<SecretsFile>

  constructor(
    filePath: string,
    private readonly cipher: Cipher
  ) {
    this.store = new JsonStore<SecretsFile>(filePath, () => ({ secrets: {} }))
  }

  private static key(repoId: string, scope: string): string {
    return `${repoId}:${scope}`
  }

  get(repoId: string, scope: string): SecretValues {
    return this.read(repoId, scope).values
  }

  /**
   * Secrets of a scope. `unreadable` means they are stored but cannot be
   * decrypted, typically because the OS keyring key changed: the encrypted
   * value is kept (it becomes readable again if the key comes back).
   */
  read(repoId: string, scope: string): { values: SecretValues; unreadable: boolean } {
    const encrypted = this.store.read().secrets[SecretStore.key(repoId, scope)]
    if (!encrypted) return { values: {}, unreadable: false }
    try {
      return { values: JSON.parse(this.cipher.decrypt(encrypted)) as SecretValues, unreadable: false }
    } catch (error) {
      console.warn(`Cannot decrypt the secrets of ${scope}: ${(error as Error).message}`)
      return { values: {}, unreadable: true }
    }
  }

  /** Stores secrets. Empty secrets never overwrite stored ones that cannot be decrypted. */
  set(repoId: string, scope: string, values: SecretValues): void {
    const cleaned = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ''))
    if (Object.keys(cleaned).length === 0 && this.read(repoId, scope).unreadable) return
    this.store.update((file) => {
      const key = SecretStore.key(repoId, scope)
      if (Object.keys(cleaned).length === 0) delete file.secrets[key]
      else file.secrets[key] = this.cipher.encrypt(JSON.stringify(cleaned))
    })
  }

  /** Moves every scope starting with `from` (a renamed collection or environment) to `to`. */
  move(repoId: string, from: string, to: string): void {
    if (from === to) return
    this.store.update((file) => {
      const prefix = SecretStore.key(repoId, from)
      for (const key of Object.keys(file.secrets)) {
        if (key === prefix || key.startsWith(`${prefix}/`)) {
          file.secrets[SecretStore.key(repoId, to) + key.slice(prefix.length)] = file.secrets[key]
          delete file.secrets[key]
        }
      }
    })
  }

  /** Forgets the secrets of a whole workspace, or of one scope and its sub-scopes. */
  forget(repoId: string, scope?: string): void {
    this.store.update((file) => {
      const prefix = scope ? SecretStore.key(repoId, scope) : `${repoId}:`
      for (const key of Object.keys(file.secrets)) {
        if (scope ? key === prefix || key.startsWith(`${prefix}/`) : key.startsWith(prefix)) delete file.secrets[key]
      }
    })
  }
}
