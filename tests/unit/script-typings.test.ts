import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SCRIPT_TYPINGS, variableTypings } from '@core/script-typings'

/** Type-checks a script as the editors do: a module with the typings as a global declaration file. */
function diagnostics(script: string): string[] {
  const files: Record<string, string> = {
    '/milka.d.ts': SCRIPT_TYPINGS + variableTypings(['baseUrl', 'token']),
    '/script.ts': script
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts'],
    strict: false,
    noEmit: true,
    moduleDetection: ts.ModuleDetectionKind.Force,
    module: ts.ModuleKind.ESNext,
    types: []
  }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  host.readFile = (name) => files[name] ?? read(name)
  host.fileExists = (name) => name in files || ts.sys.fileExists(name)
  host.getSourceFile = (name, version) => {
    const content = files[name] ?? read(name)
    return content === undefined ? undefined : ts.createSourceFile(name, content, version)
  }
  const program = ts.createProgram(Object.keys(files), options, host)
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

describe('script typings', () => {
  it('type-check a script using the whole API', () => {
    const script = `
      req.headers['X-Trace'] = milka.uuid()
      req.setHeader('Accept', 'application/json')
      req.body = { ...req.body, at: new URL(req.url).pathname }
      const token = milka.vars.get('token') ?? milka.env.get('baseUrl')
      if (!token) milka.skip('no token')
      const login = await milka.sendRequest({ method: 'POST', url: '{{baseUrl}}/login', body: { user: 'x' } })
      milka.vars.set('token', login.body.token)
      await milka.sleep(1)
      console.log(res.status, res.header('content-type'), milka.base64.encode('x'))
      test('created', () => {
        expect(res.status).toBe(201)
        expect(res.body).toHaveProperty('id')
        expect(res.body.items).not.toHaveLength(0)
      })
    `
    expect(diagnostics(script)).toEqual([])
  })

  it('report mistakes', () => {
    expect(diagnostics("expect(res.status).toBeEqual(1)\nmilka.vars.gett('x')")).toHaveLength(2)
  })
})
