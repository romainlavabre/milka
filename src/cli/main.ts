// Entry point of the standalone CLI bundle (out/cli/milka.cjs), run with Node.
import { runCli } from './index'

declare const MILKA_VERSION: string

void runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
  color: !!process.stdout.isTTY && !process.env.NO_COLOR,
  version: typeof MILKA_VERSION === 'string' ? MILKA_VERSION : 'dev'
}).then((code) => {
  process.exitCode = code
})
