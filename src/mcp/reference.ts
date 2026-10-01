// Reference served by the get_reference tool: what an assistant needs to write
// the content of requests (scripts, assertions, variables, bodies). Built from
// the constants of the engine, so it follows the code.
import { OPERATOR_LABELS, UNARY_OPERATORS } from '../core/assert-labels'
import { CONTENT_TYPES } from '../core/engine'
import { ASSERT_OPERATORS, AUTH_TYPES, BODY_TYPES, HTTP_METHODS } from '../core/model'
import { SCRIPT_TYPINGS } from '../core/script-typings'
import { BUILTIN_VARIABLES, MAX_DEPTH } from '../core/vars'

export const REFERENCE_TOPICS = ['scripts', 'assertions', 'variables', 'bodies', 'yaml'] as const
export type ReferenceTopic = (typeof REFERENCE_TOPICS)[number]

const scripts = `# Scripts and tests

Scripts are TypeScript (or JavaScript), run by Milka, not by Postman or Bruno: there is no \`pm\`, no \`bru\`, no chai
(\`expect(x).to.equal(y)\`), no \`fetch\` and no \`require\`. Use the API below.

Where they live, on collections, folders and requests:
- scripts.pre: run before sending. \`req\` is available, \`res\` is not, \`test()\` throws.
- scripts.post: run after the response, with \`req\` and \`res\`. \`test()\` is allowed.
- tests: run after the post scripts, with \`req\` and \`res\`.
Every level runs, from the outside in: collection, folders (outermost first), request.

Order of one send:
1. request vars.pre are set;
2. pre scripts run;
3. {{variables}} are replaced, auth applied, body encoded, request sent;
4. vars.post are evaluated, then post scripts run;
5. assertions run, then tests;
6. if a post script called milka.retry(), everything runs once more.

A script stops after 5 s of computing and 60 s of waiting. Top-level \`await\` is allowed.

Examples:

\`\`\`ts
// Collection, pre: fetch a token once.
if (!milka.vars.get('token')) {
  const login = await milka.sendRequest({ method: 'POST', url: '{{baseUrl}}/login', body: { user: 'ci' } })
  milka.vars.set('token', login.body.token)
}

// Collection, post: refresh an expired token and send the request again.
if (res.status === 401 && req.name !== 'Token') {
  await milka.runRequest('auth/token.yaml')
  milka.retry()
}

// Request, tests.
test('creates the user', () => {
  expect(res.status).toBe(201)
  expect(res.body).toHaveProperty('id')
})
\`\`\`

API, as TypeScript declarations:

\`\`\`ts
${SCRIPT_TYPINGS.trim()}
\`\`\`
`

function assertions(): string {
  const operators = ASSERT_OPERATORS.map(
    (op) => `- \`${op}\`: ${OPERATOR_LABELS[op]}${UNARY_OPERATORS.includes(op) ? ' (no value)' : ''}`
  ).join('\n')
  return `# Assertions

Checks without code, in the \`assertions\` list of a request: \`{ expr, op, value, enabled }\`.

- \`expr\` is evaluated on the response: \`res.status\`, \`res.body.id\`, \`res.body.items[0].name\`,
  \`res.headers['content-type']\`, \`res.time\`.
- \`value\` is read according to the actual value: "201" is a number when the actual value is a number, "true" a
  boolean, "null" null, "{...}" or "[...]" JSON when the actual value is an object or array.

Operators:
${operators}

\`contains\` is a substring of a string or an item of an array. \`isType\` takes string, number, boolean, object, array or
null. \`length\` compares the length of a string or array.

Assertions run before the tests and are reported with them. Use tests (see topic "scripts") for anything else.

\`\`\`yaml
assertions:
  - expr: res.status
    op: eq
    value: "201"
  - expr: res.body.id
    op: exists
\`\`\`
`
}

function variables(): string {
  const builtins = BUILTIN_VARIABLES.map((v) => `- \`{{${v.name}}}\`: ${v.description}`).join('\n')
  return `# Variables

\`{{name}}\` works in the URL, params, headers, bodies and auth fields. Spaces are allowed: \`{{ name }}\`.
An unknown variable is left as written. A value may use other variables, ${MAX_DEPTH} levels deep.

Precedence, highest first:
1. runtime variables, set by scripts (milka.vars.set) or by the vars.post of a request; kept in memory for the next
   requests;
2. request vars.pre;
3. folder variables, the innermost folder first;
4. the selected environment (shared variables and local secret values);
5. collection variables;
6. built-ins.

There are no global variables: collections, folders and environments hold them.

Built-ins:
${builtins}

Request variables:
- vars.pre: \`{ name, value }\` set before sending; the value may use other variables.
- vars.post: \`{ name, value }\` where value is an expression on the response, e.g. \`res.body.id\` or
  \`res.headers['location']\`. The result becomes a runtime variable for the next requests.

Path parameters: a \`:name\` segment of the URL (\`{{baseUrl}}/users/:id\`) takes the value of the params row of
type "path" with that name.

Secrets: environments list the names of their secret variables only. Their values are typed by each user in Milka and
are never readable nor writable here. Reference them as \`{{token}}\`, e.g. in a bearer auth.

In a JSON body, a variable may stand for a whole value without quotes: \`"age": {{age}}\`.
`
}

function bodies(): string {
  const types = BODY_TYPES.map((type) => `- \`${type}\`: ${CONTENT_TYPES[type] ?? (type === 'multipart' ? 'multipart/form-data' : 'no body')}`).join(
    '\n'
  )
  return `# Bodies

A request holds a list of named bodies, the payload variants of the same endpoint ("Valid user", "Missing email",
"Too long name"…). The one named by \`activeBody\` is sent, else the first. Give each variant a name that says what it
tests: the runner can run every variant, each reported as "<request> [<body>]".

Fields of a body: \`name\`, \`type\`, \`content\` (JSON, XML, text, GraphQL query; the file path for binary),
\`variables\` (GraphQL variables as JSON), \`fields\` (form and multipart: \`{ name, value, enabled, type }\`, where
type "file" sends the file at path value).

Types and the Content-Type sent, unless the request sets its own header:
${types}

Methods: ${HTTP_METHODS.join(', ')}.
Auth types: ${AUTH_TYPES.join(', ')}. "inherit" (the default of requests and folders) takes the auth of the
enclosing folder or collection; basic uses username and password, bearer a token, apikey a key and value sent in a
header or the query string ("in").
`
}

const yaml = `# Workspace layout

\`\`\`
milka.json
collections/<collection>/collection.yaml        name, color, headers, auth, vars, scripts, tests, docs
collections/<collection>/environments/<env>.yaml name, vars, secrets (names only)
collections/<collection>/<folder>/folder.yaml   name, seq, headers, auth, vars, scripts, tests, docs
collections/<collection>/<folder>/<request>.yaml
\`\`\`

A request is identified by its path in the collection, e.g. \`admin/create-user.yaml\`. Folders nest. \`seq\` orders
the sidebar.

Inheritance: headers of every level are sent, an inner header replacing an outer one of the same name; auth is the first
level not set to "inherit", from the request outwards; scripts and tests of every level run, collection first.

\`\`\`yaml
name: Create user
seq: 1
method: POST
url: "{{baseUrl}}/users"
tags: [smoke]
params:
  - name: notify
    value: "true"
headers:
  - name: X-Trace
    value: "{{$uuid}}"
auth:
  type: inherit
bodies:
  - name: Valid user
    type: json
    content: '{ "name": "{{name}}", "age": {{age}} }'
  - name: Missing name
    type: json
    content: '{ "age": 36 }'
activeBody: Valid user
vars:
  pre:
    - name: name
      value: Ada Lovelace
  post:
    - name: userId
      value: res.body.id
scripts:
  pre: req.setHeader('X-Request-Id', milka.uuid())
  post: console.log(res.status)
assertions:
  - expr: res.status
    op: eq
    value: "201"
tests: |-
  test('returns the user', () => expect(res.body).toHaveProperty('id'))
docs: Creates a user.
settings:
  timeout: 10000
\`\`\`

Edit workspaces through the tools rather than the files: they keep names, slugs and order consistent.
`

export function reference(topic: ReferenceTopic): string {
  switch (topic) {
    case 'scripts':
      return scripts
    case 'assertions':
      return assertions()
    case 'variables':
      return variables()
    case 'bodies':
      return bodies()
    case 'yaml':
      return yaml
  }
}
