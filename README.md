# Milka

Free and open-source API client, in the spirit of Bruno and Postman.

- **Unlimited workspaces**, each one a git repository, with a **Sync** button (commit, pull, push).
- **Several bodies per request**: keep every payload variant of an endpoint in a single request.
- **Pre-request / post-response scripts** in TypeScript, with autocompletion.
- **Assertions and tests** that also run in CI through the `milka run` command.
- **Environments** made of variables and secrets: secrets are encrypted on your machine and never committed.
- **Collection colors**, **OpenAPI export**, imports from Bruno, Postman, OpenAPI and cURL.
- **MCP server** so an AI assistant can create collections and requests.

> Milka is under active development; the features above are being built.

## Requirements

Linux, `git` and `openssh-client` (installed as dependencies of the `.deb`).

## Development

```bash
npm install
npm run dev          # start the app with hot reload
npm run typecheck
npm run lint
npm test             # unit tests
npm run dist         # build the .deb and AppImage into dist/
```

Set `MILKA_DATA_DIR` to use another data folder than `~/.config/milka`.

To regenerate the icon after editing `build/logo.svg`: `npx electron build/render-icon.cjs`.

## Architecture

- `src/shared` — IPC contract shared by every process.
- `src/core` — pure Node engine (model, storage, HTTP, scripts, runner), shared by the app, the CLI and the MCP server.
- `src/main` — Electron main process: workspaces, git sync, secrets, IPC handlers.
- `src/preload` — typed bridge exposed to the renderer.
- `src/renderer` — React UI.

## License

MIT
