# MCP server

`milka mcp` lets an AI assistant, such as Claude, work in your workspaces: read the collections, create and change
requests, import an API description, and run requests with their tests. Ask it to "create the requests of this OpenAPI
document with a valid body and a body missing each required field", then review the result in the app.

## Install

Claude Code:

```bash
claude mcp add milka -- milka mcp
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{ "mcpServers": { "milka": { "command": "milka", "args": ["mcp"] } } }
```

The server serves the workspaces of the app over stdio. To serve one workspace folder only, for example in a
repository that holds its own collections:

```bash
milka mcp --workspace <folder>
```

## Tools

| Group | Tools |
|---|---|
| Read | `list_workspaces`, `list_collections`, `get_collection_tree`, `get_collection`, `get_folder`, `get_request`, `list_environments` |
| Import | `import_collection`: Bruno, Postman or OpenAPI (a path, or the content as text), or a cURL command into a collection |
| Create | `create_collection`, `create_folder`, `create_request` (with several bodies), `add_body`, `create_environment` |
| Change | `update_collection` and `update_folder` (name, color, headers, auth, variables, scripts, tests, docs), `update_request` (every field, scripts and settings included), `update_environment` (set or remove variables, declare secrets) |
| Organize | `move_item`, `delete_item` |
| Run | `run_request`, with its assertions and tests |

## Rules

- **Secrets stay yours.** Secret values are never readable nor writable through MCP. The assistant declares the name of
  a secret; each user types the value in the app. For the same reason, a collection or an environment that has secrets
  is renamed from the app, which moves their local values.
- **Changes show at once.** The app watches the workspace and refreshes when the assistant writes a file.
- **Changes are committed at the next Sync**, so you can review them, and a deletion can be undone from git (see
  [Undo a deletion](workspaces.md#undo-a-deletion)).
- **Each session starts with an empty cookie jar.**
