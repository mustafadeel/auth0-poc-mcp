# Auth0 Forms MCP Custom Extension

This repository packages the MCP server from `auth0-agent-components/examples/poc-server` in the same format as Auth0's Delegated Administration Extension. The package exposes one Auth0 Form as an MCP App at the deployed extension URL plus `/mcp`.

## What is in the package

- `package.json` contains the `auth0-extension` manifest that the Custom Extension importer reads.
- `webtask.json` selects the Node 22 Webtask runtime used by the extension deployment.
- `src/webtask.ts` is the Webtask handler expected by the extension runtime.
- `src/app.ts` adapts the POC server to a stateless Streamable HTTP MCP transport.
- `dist/package.zip`, created by `npm run build`, is the file to import into the Custom Extension workflow.
- `index.js` and `build/bundle.js` support the legacy repository loader that fetches those paths from the `master` branch.

## Configure the extension

During import, set these settings:

| Setting | Required | Purpose |
| --- | --- | --- |
| `FORM_ID` | Yes | The Auth0 Form ID to expose. |
| `AUTH0_FORMS_TRUST_SECRET` | Session forms | Shared secret for the Forms session JWT. |
| `FORM_SESSION_FIELD` | Session forms | Hidden Form field receiving the session JWT, normally `session_token`. |
| `PUBLIC_BASE_URL` | External endpoint only | Optional external public MCP origin, without a trailing slash. |
| `FORMS_ORIGIN` | No | Absolute custom origin that hosts the Forms bundle. |

`FORM_DESCRIPTION` and `FORM_NAME` control the model-facing tool description and tool name.

## Provision the tenant API

The extension requests an extension-owned Management API client with only `read:resource_servers` and `create:resource_servers`. It reads the tenant domain from the runtime and creates or reuses an Auth0 API whose identifier is the exact installed MCP URL.

1. Perform a full Custom Extension update or reinstall after importing version `0.4.0` so Auth0 creates the managed client and grants its declared scopes.
2. Open the extension landing page and select **Sign in and provision**.
3. Complete the tenant-admin login. The landing page creates or reuses the required API audience, then shows its status.
4. Connect the MCP client to the displayed MCP endpoint.

Provisioning is available only through the Dashboard-admin login flow. Public MCP, health, and discovery routes never modify tenant configuration. `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_DOMAIN`, and `EXTENSION_SECRET` are runtime-managed values; do not add them to extension settings or log them.

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

The repository also publishes a `master` branch because the legacy Custom Extension loader fetches `index.js` and `build/bundle.js` from that branch. Do not remove the generated `build/bundle.js` file.

## Import and connect

1. Import `dist/package.zip` into the same Custom Extension workflow that accepts the Delegated Administration Extension package format.
2. Enter the configuration values above.
3. Open the installed extension and complete **Sign in and provision** once.
4. Register the displayed MCP URL in an MCP client. The extension advertises its protected-resource metadata at `/.well-known/oauth-protected-resource`.

The extension uses a stateless MCP transport because Webtask-style extension runtimes do not guarantee that the same process handles successive requests. It does not support server-initiated notifications or resumable SSE sessions.

## OAuth discovery companion

Webtask routes are scoped under the extension name, so the platform cannot serve the host-root OAuth protected-resource metadata URL. Use the companion Custom Extension at `https://github.com/mustafadeel/auth0-ext-wellknown`; it stays in the same Auth0 tenant and does not require an external proxy.

1. Import `auth0-ext-wellknown` into the same tenant as a second Custom Extension. Keep its name as `.well-known` and `useHashName` as `false`.
2. Set `MCP_RESOURCE_URL` to the displayed MCP URL, `AUTH0_TENANT_ORIGIN` to the canonical tenant issuer, and optionally set `RESOURCE_NAME`.
3. Connect the client to the MCP URL from this extension, never the companion extension URL.

For an intentionally external proxy or custom domain, set `PUBLIC_BASE_URL` to the proxy origin before provisioning. The extension derives the API audience as `${PUBLIC_BASE_URL}/mcp`.

## Local development

Copy `.env.example` to `.env.local`, configure it, then run:

```bash
npm run dev
```

Connect the MCP Inspector to `http://localhost:3000/mcp`.
