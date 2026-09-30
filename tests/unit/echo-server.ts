// In-process HTTP server used by the engine, runner and CLI tests.
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface EchoServer {
  url: string
  close(): Promise<void>
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/**
 * Routes:
 * - `/echo…` returns the received method, path, headers and body as JSON
 * - `/status/<code>` answers with that status
 * - `/redirect` sends to `/echo?redirected=1`
 * - `/login` sets the cookie SESSION=abc
 * - `/login-redirect` sets the cookie HOP=1 and sends to `/echo`
 * - `/users` POST creates a user from a JSON body with a name (400 without)
 * - `/slow` answers after 2 seconds
 */
export async function startEchoServer(): Promise<EchoServer> {
  let nextId = 1
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req)
    const url = new URL(req.url ?? '/', 'http://localhost')
    const json = (status: number, value: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (url.pathname.startsWith('/echo')) return json(200, { method: req.method, path: req.url, headers: req.headers, body })
    if (url.pathname.startsWith('/status/')) return json(Number(url.pathname.split('/')[2]), { ok: false })
    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/echo?redirected=1' })
      return res.end()
    }
    if (url.pathname === '/login') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'SESSION=abc; Path=/; HttpOnly' })
      return res.end(JSON.stringify({ ok: true }))
    }
    if (url.pathname === '/login-redirect') {
      res.writeHead(302, { Location: '/echo', 'Set-Cookie': 'HOP=1; Path=/' })
      return res.end()
    }
    if (url.pathname === '/users' && req.method === 'POST') {
      const parsed = (() => {
        try {
          return JSON.parse(body) as { name?: string }
        } catch {
          return {}
        }
      })()
      if (!parsed.name) return json(400, { error: 'name is required' })
      return json(201, { id: nextId++, name: parsed.name })
    }
    if (url.pathname === '/slow') {
      setTimeout(() => json(200, { slow: true }), 2000)
      return
    }
    json(404, { error: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
