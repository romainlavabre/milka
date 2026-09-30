# Milka

Free and open-source API client, in the spirit of Bruno and Postman, with what they charge for or lack:

- **Unlimited workspaces**, each one a git repository, with a **Sync** button (commit, pull, push) and conflict resolution.
- **Several bodies per request**: keep every payload variant of an endpoint (valid, missing field, edge case…) in one request, and pick the one to send.
- **Pre-request / post-response scripts in TypeScript**, with autocompletion and documentation of the whole script API.
- **Assertions and tests** that run in the app and **in CI** with `milka run`, with JUnit and JSON reports.
- **Environments** made of shared variables and **secrets encrypted on your machine**, never committed.
- **Collection colors**, **OpenAPI 3.1 export**, imports from **Bruno, Postman, OpenAPI and cURL**.
- **MCP server** so an AI assistant can create collections and requests, and run them.

## Install

Linux x86_64, with `git` and `openssh-client` (dependencies of the `.deb`).

```bash
curl -fsSL https://raw.githubusercontent.com/romainlavabre/milka/master/install.sh | bash
```

Debian and Ubuntu get the `.deb` package (menu entry and `milka` command); other distributions get the AppImage unpacked
in `~/.local/share/milka`. `./install.sh --help` lists the options (a given version, a downloaded file, `--from-source`,
`--uninstall`).

Milka then updates itself: when a new release is out, a card offers to install it (the `.deb` asks for your password in
a system window) and to restart.

## Workspaces

A workspace is a git repository. Create one, clone the repository of your team, or open a folder, from the workspace
menu at the top of the sidebar; there is no limit on their number.

**Sync** commits your local changes, pulls those of your colleagues (rebasing on `master`) and pushes. Every change made
in the app is also committed on its own, with a readable message (`Add request "Create user"`), and pushed in the
background. When the same file changed on both sides, Milka shows the conflicting files and you keep your version or
theirs, file by file.

SSH remotes use your SSH agent; HTTPS remotes use your git credential helper. Milka never asks for a password.

### Layout

```
milka.json
collections/
  users-api/
    collection.yaml              name, color, headers, auth, variables, scripts, tests, docs
    environments/
      staging.yaml               shared variables, and the names of the secret ones
    admin/
      folder.yaml                what the requests of the folder inherit
      create-user.yaml           one file per request
```

A request is plain YAML, easy to review in a pull request:

```yaml
name: Create user
seq: 1
method: POST
url: "{{baseUrl}}/users"
headers:
  - name: Content-Type
    value: application/json
bodies:
  - name: Valid user
    type: json
    content: |-
      { "name": "{{name}}", "email": "ada@example.com" }
  - name: Missing email
    type: json
    content: '{ "name": "Ada" }'
activeBody: Valid user
vars:
  post:
    - name: userId
      value: res.body.id
assertions:
  - expr: res.status
    op: eq
    value: "201"
tests: |-
  test('returns the user', () => expect(res.body).toHaveProperty('email'))
```

## Variables and secrets

`{{name}}` works in URLs, params, headers, bodies and auth. Variables resolve, from the highest precedence:
runtime variables set by scripts, request variables, folder variables (innermost first), the selected environment,
collection variables. `{{process.env.NAME}}`, `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}` and `{{$randomInt}}`
are built in.

Mark an environment variable as secret with its lock: the environment file keeps its name only, and each teammate types
the value, stored encrypted with the system keyring (a local key file when there is no keyring) in
`~/.config/milka/secrets.json`.

Drag the grip at the start of a row to reorder variables, secrets, params, headers, form fields and assertions. As an
environment file lists its variables and its secrets apart, it records an `order` when you mix them.

## Scripts and tests

Scripts are TypeScript. The editor completes and documents the API:

```ts
// Pre-request
req.headers['X-Request-Id'] = milka.uuid()
if (!milka.vars.get('token')) {
  const login = await milka.sendRequest({ method: 'POST', url: '{{baseUrl}}/login', body: { user: 'ci' } })
  milka.vars.set('token', login.body.token)
}

// Post-response and tests
test('created', () => {
  expect(res.status).toBe(201)
  expect(res.body.items).not.toHaveLength(0)
})
```

- `req`: `method`, `url`, `headers`, `body` (parsed JSON for JSON bodies), `bodyName`, `setHeader()`, `removeHeader()`.
- `res`: `status`, `headers`, `body` (parsed JSON), `text`, `time`, `size`, `header()`.
- `milka`: `vars.get/set/has/delete`, `env.name/get`, `cookies`, `sendRequest()`, `runRequest(path, { body })`, `retry()`,
  `skip()`, `uuid()`, `sleep()`, `base64`.
- `milka.runRequest(path)` executes a request of the same collection (`service-auth/token.yaml`) with its inherited
  headers, auth and scripts, and returns its response. It shares the variables, environment and cookie jar of the
  current request, shows its logs in the console and keeps its tests to itself; it throws when the request fails, and
  nests 3 levels deep at most.
- `milka.retry()`, in post-response scripts only, sends the request once more after every post-response script, from its
  pre-request scripts on. Once per execution: the result is the one of the second send, marked **Retried**.
- `milka.cookies`: `get(url, name)`, `getAll(url)`, `set(url, name, value, { path, domain, expires, secure, httpOnly })`,
  `delete(url, name)`, `clear(url?)`; `url` is any URL of the site, `{{variables}}` allowed.
- `test(name, fn)` and `expect(value)`: `toBe`, `toEqual`, `toBeDefined`, `toContain`, `toMatch`, `toHaveLength`,
  `toHaveProperty`, `toBeGreaterThan`… with `.not`.

Scripts of the collection and of the folders run before those of the request. They run with your rights, like the
scripts of a `package.json`: only open workspaces you trust.

Cookies work as in a browser: the ones a response sets (redirects included) are sent back to the requests they match,
by domain, path, expiry and `Secure`. The app keeps them per workspace until it quits, never on disk; the cookie button
of the request bar lists them and deletes them. A run, `milka run` and each MCP session start with an empty jar.

To refresh an expired token carried by a cookie, let the post-response script of the `Token` request store it:

```ts
// service-auth/token.yaml, post-response
milka.cookies.set(milka.env.get('host'), 'ACCESS_TOKEN', res.body.access_token)
```

and the post-response script of the collection run it and send the request again on 401:

```ts
if (res.status === 401 && req.name !== 'Token') {
  await milka.runRequest('service-auth/token.yaml')
  milka.retry()
}
```

The **Assert** tab covers the common checks without code: `res.status equals 201`, `res.body.id exists`,
`res.headers['content-type'] contains json`.

## Command line and CI

```bash
milka run collections/users-api --env staging --all-bodies --reporter junit=reports/api.xml
```

`milka run` takes a workspace, a collection, a folder or a request file. It exits with 1 when a request or a test fails.
Options: `--env`, `--env-var name=value`, `--reporter junit=… | json=…`, `--all-bodies` (one run per body variant),
`--tags`, `--exclude-tags`, `--bail`, `--insecure`, `--delay`. Secret values come from `--env-var` or from
`MILKA_SECRET_<NAME>` variables; on your machine, `milka run` also uses the secrets typed in the app.

CI machines only need Node.js 20+: every release ships `milka-cli-X.Y.Z.cjs`, a single file.

```yaml
# .github/workflows/api.yml
jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: gh release download --repo romainlavabre/milka --pattern 'milka-cli-*.cjs' --output milka.cjs
        env: { GH_TOKEN: '${{ github.token }}' }
      - run: node milka.cjs run collections/users-api --env ci --reporter junit=reports/api.xml
        env: { MILKA_SECRET_TOKEN: '${{ secrets.API_TOKEN }}' }
```

Other commands: `milka import bruno|postman|openapi <source>`, `milka import curl "<command>" --into collections/<collection>`,
`milka export openapi collections/<collection> -o openapi.yaml`, `milka mcp`. `milka help` shows them all.

## Import and export

- **Bruno**: a collection folder, in the `.bru` format or the YAML format of Bruno 3 (`opencollection.yml`), with its
  folders, environments (secret variables stay secret), assertions and scripts, converted to the Milka API where a call
  has an equivalent (chai assertions such as `expect(x).to.equal(y)` included). The bodies of saved examples become
  extra bodies. WebSocket requests are skipped.
- **Postman**: collections v2.1, where the bodies of saved examples become extra bodies; environments from the
  environments panel.
- **OpenAPI 3** (YAML or JSON): one request per operation, grouped by tag, named examples as bodies, servers as
  environments.
- **cURL**: paste a command, e.g. from "Copy as cURL" in the browser dev tools.
- **Export**: a collection as an OpenAPI 3.1 document, the bodies of each request as named examples.

## MCP server

`milka mcp` serves the workspaces of the app over stdio. Its tools:

- read: `list_workspaces`, `list_collections`, `get_collection_tree`, `get_collection`, `get_folder`, `get_request`,
  `list_environments`;
- import: `import_collection`, from Bruno, Postman or OpenAPI (a path, or the content as text), or a cURL command
  into a collection;
- create: `create_collection`, `create_folder`, `create_request` (with several bodies), `add_body`,
  `create_environment`;
- change: `update_collection` and `update_folder` (name, color, headers, auth, variables, scripts, tests, docs),
  `update_request` (every field, scripts and settings included), `update_environment` (set or remove variables,
  declare secrets);
- organize: `move_item`, `delete_item`;
- run: `run_request`, with its assertions and tests.

Secret values are never readable nor writable through MCP: the assistant declares the name, each user types the value.
For the same reason, a collection or an environment with secrets is renamed from the app, which moves their local
values. Changes appear in the app at once and are committed at the next Sync, so a deletion can be undone from git.

```bash
claude mcp add milka -- milka mcp
```

For Claude Desktop, in `claude_desktop_config.json`:

```json
{ "mcpServers": { "milka": { "command": "milka", "args": ["mcp"] } } }
```

`milka mcp --workspace <folder>` serves one workspace folder instead of those of the app.

## Development

```bash
npm install
npm run dev          # the app with hot reload
./run.sh --sandbox   # the same, with a throwaway data folder in .sandbox/
npm run typecheck
npm run lint
npm test             # unit tests (engine, storage, git sync, CLI, MCP, imports)
npm run test:e2e     # end-to-end tests of the app with Playwright
npm run dist         # .deb and AppImage in dist/, standalone CLI in out/cli/milka.cjs
./tag.sh             # publish a release
```

Set `MILKA_DATA_DIR` to use another data folder than `~/.config/milka`. To regenerate the icon after editing
`build/logo.svg`: `npx electron build/render-icon.cjs`.

### Architecture

- `src/core`: the engine, pure Node and shared by the app, the CLI and the MCP server: model and YAML storage,
  variables, HTTP, scripts, assertions, runner, reporters, imports and export.
- `src/main`: Electron main process: workspaces and git sync, secrets, IPC handlers.
- `src/preload`: typed bridge exposed to the renderer.
- `src/renderer`: React UI.
- `src/cli`, `src/mcp`: command line and MCP server.

## License

MIT
