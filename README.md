# Auth0 Forms MCP Custom Extension

This repository packages the MCP server from `auth0-agent-components/examples/poc-server` in the same format as Auth0's Delegated Administration Extension. The package exposes one Auth0 Form as an MCP App at the deployed extension URL plus `/mcp`.

## What is in the package

- `package.json` contains the `auth0-extension` manifest that the Custom Extension importer reads.
- `src/webtask.ts` is the Webtask handler expected by the extension runtime.
- `src/app.ts` adapts the POC server to a stateless Streamable HTTP MCP transport.
- `dist/package.zip`, created by `npm run build`, is the file to import into the Custom Extension workflow.

## Configure the extension

During import, set these settings:

| Setting | Required | Purpose |
| --- | --- | --- |
| `AUTH0_TENANT_ORIGIN` | Yes | Canonical tenant issuer, such as `https://tenant.us.auth0.com`. |
| `FORM_ID` | Yes | The Auth0 Form ID to expose. |
| `AUTH0_FORMS_TRUST_SECRET` | Session forms | Shared secret for the Forms session JWT. |
| `FORM_SESSION_FIELD` | Session forms | Hidden Form field receiving the session JWT, normally `session_token`. |
| `AUTH0_AUDIENCE` | Recommended | API identifier used when Auth0 mints the MCP access token. |
| `FORMS_ORIGIN` | No | Custom domain that hosts the Forms bundle. |
| `MCP_AUTH` | No | Leave on in production. Set off only for no-session local development. |

`FORM_DESCRIPTION` and `FORM_NAME` control the model-facing tool description and tool name.

## Build an importable package

The local `@auth0/agent-components` dependency points to the sibling source repository because it is not available from the configured npm registry. Keep these two directories adjacent while building:

```text
/Users/adeel.mustafa/
  auth0-agent-components/
  auth0-mcp-custom-extension/
```

Then run:

```bash
npm install
npm run build
```

The importer artifact is `dist/package.zip`. It contains the bundled `extension.js` and a runtime-only `package.json`; neither references the sibling checkout once imported.

## Import and connect

1. Import `dist/package.zip` into the same Custom Extension workflow that accepts the Delegated Administration Extension package format.
2. Enter the configuration values above.
3. Open the installed extension. Its landing page displays the exact MCP endpoint URL.
4. Register that URL in an MCP client. The client must obtain an Auth0 access token for `AUTH0_AUDIENCE`; the extension advertises its protected-resource metadata at `/.well-known/oauth-protected-resource`.

The extension uses a stateless MCP transport because Webtask-style extension runtimes do not guarantee that the same process handles successive requests. It does not support server-initiated notifications or resumable SSE sessions.

## Local development

Copy `.env.example` to `.env.local`, configure it, then run:

```bash
npm run dev
```

Connect the MCP Inspector to `http://localhost:3000/mcp`.
