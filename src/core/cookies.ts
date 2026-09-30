// Cookie jar shared by the requests of a session or a run, like a browser's:
// Set-Cookie headers are stored per domain and path, and sent back to the
// requests they match. The rules (domain and path matching, expiry, Secure,
// public suffixes) are those of tough-cookie.
import { Cookie, CookieJar, MemoryCookieStore } from 'tough-cookie'
import type { CookieInfo } from './results'

export type { CookieInfo } from './results'

/** Attributes of a cookie set by a script. */
export interface CookieOptions {
  path?: string
  /** Also sends the cookie to the subdomains of this domain. */
  domain?: string
  /** Date, or seconds from now. */
  expires?: Date | string | number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

const ignore = (): void => undefined

function info(cookie: Cookie): CookieInfo {
  // A session cookie has no expiry: tough-cookie gives it a far-off date.
  const expires = cookie.isPersistent() ? cookie.expiryDate() : undefined
  return {
    name: cookie.key,
    value: cookie.value,
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    expires: expires ? expires.toISOString() : null,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    hostOnly: cookie.hostOnly ?? false
  }
}

export class Cookies {
  private readonly store = new MemoryCookieStore()
  private readonly jar = new CookieJar(this.store, { looseMode: true })

  /** The Cookie header value for a request to `url`, empty when no cookie matches. */
  header(url: string): string {
    return this.jar.getCookieStringSync(url)
  }

  /** Stores the Set-Cookie headers of a response to `url`; invalid ones are ignored, as browsers do. */
  receive(url: string, setCookie: string[]): void {
    for (const header of setCookie) this.jar.setCookieSync(header, url, { ignoreError: true })
  }

  set(url: string, name: string, value: string, options: CookieOptions = {}): void {
    const parts = [`${name}=${value}`, `Path=${options.path ?? '/'}`]
    if (options.domain) parts.push(`Domain=${options.domain}`)
    if (options.expires !== undefined) {
      const date = typeof options.expires === 'number' ? new Date(Date.now() + options.expires * 1000) : new Date(options.expires)
      parts.push(`Expires=${date.toUTCString()}`)
    }
    if (options.secure) parts.push('Secure')
    if (options.httpOnly) parts.push('HttpOnly')
    if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
    // Unlike a response, a script is told why its cookie is refused.
    this.jar.setCookieSync(parts.join('; '), url)
  }

  /** Value of the cookie `name` that a request to `url` would send. */
  get(url: string, name: string): string | undefined {
    return this.jar.getCookiesSync(url).find((cookie) => cookie.key === name)?.value
  }

  /** Name → value of the cookies a request to `url` would send. */
  getAll(url: string): Record<string, string> {
    return Object.fromEntries(this.jar.getCookiesSync(url).map((cookie) => [cookie.key, cookie.value]))
  }

  /** Deletes the cookie `name` that a request to `url` would send. */
  delete(url: string, name: string): void {
    for (const cookie of this.jar.getCookiesSync(url)) {
      if (cookie.key === name) this.remove(cookie.domain ?? '', cookie.path ?? '/', cookie.key)
    }
  }

  /** Deletes the cookies a request to `url` would send, or every cookie without `url`. */
  clear(url?: string): void {
    if (url === undefined) {
      this.jar.removeAllCookiesSync()
      return
    }
    for (const cookie of this.jar.getCookiesSync(url)) this.remove(cookie.domain ?? '', cookie.path ?? '/', cookie.key)
  }

  /** Every stored cookie, expired ones left out. */
  list(): CookieInfo[] {
    const now = Date.now()
    const cookies: CookieInfo[] = []
    // The memory store is synchronous: the callback runs before getAllCookies returns.
    this.store.getAllCookies((error, all) => {
      if (error || !all) return
      for (const cookie of all) {
        const expires = cookie.expiryTime()
        if (expires === undefined || expires > now) cookies.push(info(cookie))
      }
    })
    return cookies.sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.name.localeCompare(b.name))
  }

  /** Deletes one stored cookie, as listed by `list()`. */
  remove(domain: string, path: string, name: string): void {
    this.store.removeCookie(domain, path, name, ignore)
  }
}
