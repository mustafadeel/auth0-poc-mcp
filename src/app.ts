import type { Request, RequestHandler, Response } from "express";
import { createHash } from "node:crypto";
import express from "express";
import { ApiClient, ProtectedResourceMetadataBuilder } from "@auth0/auth0-api-js";
import { createAgentComponents, type Auth0FormConfig } from "@auth0/agent-components";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type ConfigReader = (key: string) => string | undefined;

const protectedResourceMetadataPath = "/.well-known/oauth-protected-resource";
const setupAdminPath = "/.extensions/setup";
const setupAudience = "urn:auth0-forms-mcp-setup";
const setupSessionStorageKey = "auth0-forms-mcp:setup-token";

interface WebtaskRequest extends Request {
  x_wt?: {
    ectx?: {
      PUBLIC_WT_URL?: unknown;
    };
  };
}

interface LegacyExtensionTools {
  middlewares: {
    authenticateAdmins: (options: Record<string, unknown>) => RequestHandler;
  };
  routes: {
    dashboardAdmins: (options: Record<string, unknown>) => RequestHandler;
  };
}

interface ResourceServer {
  id: string;
  identifier: string;
}

interface SetupAdminAuth {
  authenticate: RequestHandler;
  routes: RequestHandler;
}

class ManagementApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface ExtensionConfig {
  audience?: string;
  formDescription: string;
  formId: string;
  formName?: string;
  formsOrigin: string;
  mcpAuthEnabled: boolean;
  sessionField?: string;
  tenantOrigin: string;
  trustSecret?: string;
}

function readConfig(config: ConfigReader, key: string): string | undefined {
  const value = config(key) ?? process.env[key];
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function getExtensionConfig(config: ConfigReader): ExtensionConfig {
  const tenantOrigin = tenantOriginFromConfig(config);
  const formId = readConfig(config, "FORM_ID");

  if (tenantOrigin.includes("YOUR_TENANT")) {
    throw new Error("AUTH0_TENANT_ORIGIN must be configured with the canonical Auth0 tenant origin.");
  }
  if (!formId || formId === "ap_YOUR_FORM_ID") {
    throw new Error("FORM_ID must be configured with an Auth0 Form identifier.");
  }

  return {
    audience: readConfig(config, "AUTH0_AUDIENCE"),
    formDescription:
      readConfig(config, "FORM_DESCRIPTION") ??
      "Open this form when the user needs to complete the configured Auth0 Form.",
    formId,
    formName: readConfig(config, "FORM_NAME"),
    formsOrigin: readConfig(config, "FORMS_ORIGIN") ?? tenantOrigin,
    mcpAuthEnabled: readConfig(config, "MCP_AUTH") !== "off",
    sessionField: readConfig(config, "FORM_SESSION_FIELD"),
    tenantOrigin,
    trustSecret: readConfig(config, "AUTH0_FORMS_TRUST_SECRET"),
  };
}

function tenantOriginFromConfig(config: ConfigReader): string {
  const configuredOrigin = readConfig(config, "AUTH0_TENANT_ORIGIN");
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");

  const domain = readConfig(config, "AUTH0_DOMAIN");
  if (!domain) {
    throw new Error("AUTH0 tenant settings are unavailable. Update or reinstall the extension with its managed Auth0 client enabled.");
  }

  return `https://${toAuth0Domain(domain)}`;
}

function requestHeader(req: Request, name: string): string | undefined {
  const expressHeader = req.header;
  if (typeof expressHeader === "function") {
    const value = expressHeader.call(req, name);
    if (typeof value === "string") return value;
  }

  const value = req.headers?.[name.toLowerCase()];
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function installedExtensionBaseUrl(config: ConfigReader, req: Request): string {
  const webtaskUrl = (req as WebtaskRequest).x_wt?.ectx?.PUBLIC_WT_URL;
  if (typeof webtaskUrl === "string" && webtaskUrl) return webtaskUrl.replace(/\/$/, "");

  const configuredUrl = readConfig(config, "PUBLIC_WT_URL");
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const protocol = requestHeader(req, "x-forwarded-proto") ?? req.protocol ?? "https";
  const host = requestHeader(req, "x-forwarded-host") ?? requestHeader(req, "host");
  if (!host) throw new Error("Unable to determine the public extension URL.");

  const pathname = (req.originalUrl ?? req.url ?? "/").split("?", 1)[0];
  const routeSuffix = [
    "/.well-known/oauth-protected-resource/mcp",
    "/mcp",
    "/health",
    "/.well-known/oauth-protected-resource",
  ].find((suffix) => pathname.endsWith(suffix));
  const basePath = routeSuffix ? pathname.slice(0, -routeSuffix.length) : pathname === "/" ? "" : pathname;
  return `${protocol}://${host}${basePath}`;
}

function extensionBaseUrl(config: ConfigReader, req: Request): string {
  const publicBaseUrl = readConfig(config, "PUBLIC_BASE_URL");
  return publicBaseUrl ? publicBaseUrl.replace(/\/$/, "") : installedExtensionBaseUrl(config, req);
}

function mcpUrl(config: ConfigReader, req: Request): string {
  return `${extensionBaseUrl(config, req)}/mcp`;
}

function protectedResourceMetadataUrl(config: ConfigReader, req: Request): string {
  const endpoint = new URL(mcpUrl(config, req));
  return `${endpoint.origin}${protectedResourceMetadataPath}${endpoint.pathname}`;
}

function setupAdminAuth(config: ConfigReader, req: Request): SetupAdminAuth | undefined {
  const extensionSecret = readConfig(config, "EXTENSION_SECRET");
  const domain = readConfig(config, "AUTH0_DOMAIN");
  if (!extensionSecret || !domain) return undefined;

  const extensionTools = require("auth0-extension-express-tools") as LegacyExtensionTools;
  const baseUrl = installedExtensionBaseUrl(config, req);
  const options = {
    audience: setupAudience,
    baseUrl,
    clientName: "Auth0 Forms MCP",
    domain: toAuth0Domain(domain),
    noAccessToken: true,
    rta: toAuth0Domain(readConfig(config, "AUTH0_RTA") ?? domain),
    scopes: "read:resource_servers create:resource_servers",
    secret: extensionSecret,
    sessionStorageKey: setupSessionStorageKey,
    urlPrefix: setupAdminPath,
  };

  return {
    authenticate: extensionTools.middlewares.authenticateAdmins({
      audience: options.audience,
      baseUrl: options.baseUrl,
      secret: options.secret,
    }),
    routes: extensionTools.routes.dashboardAdmins(options),
  };
}

function managementCredentials(config: ConfigReader) {
  const domain = readConfig(config, "AUTH0_DOMAIN");
  const clientId = readConfig(config, "AUTH0_CLIENT_ID");
  const clientSecret = readConfig(config, "AUTH0_CLIENT_SECRET");

  if (!domain || !clientId || !clientSecret) {
    throw new Error("The extension management client is unavailable. Update or reinstall the extension before provisioning its API.");
  }

  return { clientId, clientSecret, domain: toAuth0Domain(domain) };
}

async function managementAccessToken(config: ConfigReader): Promise<{ domain: string; token: string }> {
  const credentials = managementCredentials(config);
  const response = await fetch(`https://${credentials.domain}/oauth/token`, {
    body: JSON.stringify({
      audience: `https://${credentials.domain}/api/v2/`,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "client_credentials",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) throw new Error(`Unable to obtain a Management API token (${response.status}).`);
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("The Management API token response did not contain an access token.");
  }

  return { domain: credentials.domain, token: payload.access_token };
}

async function managementApiJson<T>(
  domain: string,
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://${domain}/api/v2/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) throw new ManagementApiError(`Management API request failed (${response.status}).`, response.status);
  return (await response.json()) as T;
}

async function listResourceServers(domain: string, token: string): Promise<ResourceServer[]> {
  const resourceServers: ResourceServer[] = [];
  const perPage = 100;

  for (let page = 0; page < 20; page += 1) {
    const result = await managementApiJson<unknown>(
      domain,
      token,
      `resource-servers?page=${page}&per_page=${perPage}`,
    );
    const currentPage = Array.isArray(result)
      ? result
      : Array.isArray((result as { resource_servers?: unknown[] }).resource_servers)
        ? (result as { resource_servers: unknown[] }).resource_servers
        : [];
    const validResources = currentPage.filter(
      (resource): resource is ResourceServer =>
        typeof resource === "object" &&
        resource !== null &&
        typeof (resource as ResourceServer).id === "string" &&
        typeof (resource as ResourceServer).identifier === "string",
    );
    resourceServers.push(...validResources);
    if (currentPage.length < perPage) break;
  }

  return resourceServers;
}

async function ensureResourceServer(config: ConfigReader, audience: string) {
  const { domain, token } = await managementAccessToken(config);
  const existing = (await listResourceServers(domain, token)).find((resource) => resource.identifier === audience);
  if (existing) return { audience, resourceServerId: existing.id, status: "reused" as const };

  try {
    const created = await managementApiJson<ResourceServer>(domain, token, "resource-servers", {
      body: JSON.stringify({
        identifier: audience,
        name: "Auth0 Forms MCP",
        scopes: [],
        signing_alg: "RS256",
      }),
      method: "POST",
    });

    return { audience, resourceServerId: created.id, status: "created" as const };
  } catch (error) {
    if (!(error instanceof ManagementApiError) || error.status !== 409) throw error;

    const concurrentResource = (await listResourceServers(domain, token)).find(
      (resource) => resource.identifier === audience,
    );
    if (!concurrentResource) throw error;
    return { audience, resourceServerId: concurrentResource.id, status: "reused" as const };
  }
}

function createForms(config: ExtensionConfig): Auth0FormConfig[] {
  return [
    {
      formId: config.formId,
      formName: config.formName,
      description: config.formDescription,
      inputMode: "none",
      ...(config.sessionField ? { session: { field: config.sessionField } } : {}),
      onComplete: (result) => {
        console.log(`[auth0-forms-mcp] form ${result.formId} completed with status ${result.status}`);
      },
    },
  ];
}

async function createMcpServer(config: ExtensionConfig): Promise<McpServer> {
  if (config.sessionField && !config.trustSecret) {
    throw new Error("AUTH0_FORMS_TRUST_SECRET is required when FORM_SESSION_FIELD is configured.");
  }

  const server = new McpServer({ name: "auth0-forms-mcp-extension", version: "0.3.0" });
  const agentComponents = createAgentComponents({
    tenantOrigin: config.formsOrigin,
    assumeUiSupport: true,
    hydrateFromTenant: true,
    ...(config.trustSecret ? { sessionTrust: { secret: config.trustSecret } } : {}),
    resolveUserSub: subFromExtra,
  });

  server.registerTool(
    "whoami",
    { description: "Return the authenticated Auth0 user's subject identifier." },
    async (extra) => {
      const sub = subFromExtra(extra);
      return {
        content: [
          {
            type: "text",
            text: sub ? `You are ${sub}.` : "No authenticated user is available for this request.",
          },
        ],
      };
    },
  );

  await agentComponents.register(server as unknown as Parameters<typeof agentComponents.register>[0], createForms(config));
  return server;
}

function toAuth0Domain(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function inspectProtectedHeader(token: string) {
  const protectedHeader = token.split(".", 1)[0] ?? "";
  const isBase64Url = /^[A-Za-z0-9_-]+$/.test(protectedHeader);

  if (!isBase64Url) {
    return { base64Url: false, json: false };
  }

  try {
    const base64 = protectedHeader.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
    const value: unknown = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return { base64Url: true, json: typeof value === "object" && value !== null && !Array.isArray(value) };
  } catch {
    return { base64Url: true, json: false };
  }
}

function createAuth0Verifier(domain: string, audience: string): OAuthTokenVerifier {
  const client = new ApiClient({ domain: toAuth0Domain(domain), audience });

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let claims;
      try {
        claims = await client.verifyAccessToken({ accessToken: token });
      } catch (error) {
        console.error("[auth0-forms-mcp] rejected access token", {
          fingerprint: createHash("sha256").update(token).digest("hex").slice(0, 12),
          length: token.length,
          segments: token.split(".").length,
          protectedHeader: inspectProtectedHeader(token),
          containsWhitespace: /\s/.test(token),
        });
        console.error("[auth0-forms-mcp] access token verification failed", error);
        throw new InvalidTokenError("invalid access token");
      }

      const sub = typeof claims.sub === "string" ? claims.sub : undefined;
      if (!sub) throw new InvalidTokenError("access token has no sub claim");

      const clientId =
        typeof claims.azp === "string"
          ? claims.azp
          : typeof claims.aud === "string"
            ? claims.aud
            : Array.isArray(claims.aud)
              ? claims.aud.find((audience): audience is string => typeof audience === "string") ?? ""
              : "";

      return {
        token,
        clientId,
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
        extra: { sub, ...(claims.act ? { act: claims.act } : {}) },
      };
    },
  };
}

function subFromExtra(extra: unknown): string | undefined {
  const authInfo = (extra as { authInfo?: AuthInfo } | undefined)?.authInfo;
  const sub = authInfo?.extra?.sub;
  return typeof sub === "string" ? sub : undefined;
}

function bearerAuth(configReader: ConfigReader, config: ExtensionConfig, req: Request): RequestHandler | undefined {
  if (!config.mcpAuthEnabled) return undefined;

  const issuer = config.tenantOrigin.endsWith("/") ? config.tenantOrigin : `${config.tenantOrigin}/`;
  const endpoint = mcpUrl(configReader, req);
  const verifier = createAuth0Verifier(config.tenantOrigin, config.audience ?? endpoint);

  return requireBearerAuth({
    verifier,
    resourceMetadataUrl: protectedResourceMetadataUrl(configReader, req),
  });
}

async function handleMcpRequest(config: ExtensionConfig, req: Request, res: Response): Promise<void> {
  const server = await createMcpServer(config);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function escapeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function extensionRoutes(path: string): string[] {
  return [path, `/:extensionName${path}`];
}

export function createExtensionApp(configReader: ConfigReader, initialRequest?: Request) {
  const app = express();
  app.use(express.json());

  const setupAuth = initialRequest ? setupAdminAuth(configReader, initialRequest) : undefined;
  if (setupAuth) {
    app.use(setupAuth.routes);
    app.use("/:extensionName", setupAuth.routes);
  }

  app.get(extensionRoutes("/"), (req, res) => {
    const endpoint = mcpUrl(configReader, req);
    const setupBaseUrl = installedExtensionBaseUrl(configReader, req);
    const setup = setupAuth
      ? `<section><h2>Tenant setup</h2><p id="setup-status">Sign in as a tenant administrator to provision this endpoint's Auth0 API audience.</p><p><a id="setup-login" href="${escapeHtml(`${setupBaseUrl}${setupAdminPath}/login`)}">Sign in and provision</a></p><script>const setup=${escapeInlineJson({ endpoint: `${setupBaseUrl}/setup/provision`, storageKey: setupSessionStorageKey })};const token=sessionStorage.getItem(setup.storageKey);if(token){const status=document.getElementById("setup-status");status.textContent="Provisioning the Auth0 API audience…";fetch(setup.endpoint,{method:"POST",headers:{Authorization:"Bearer "+token}}).then(async response=>({ok:response.ok,body:await response.json()})).then(result=>{if(!result.ok)throw new Error(result.body.message||"Setup failed.");status.textContent="Auth0 API audience "+result.body.status+": "+result.body.audience;document.getElementById("setup-login").remove();}).catch(error=>{status.textContent="Setup failed: "+error.message;});}</script></section>`
      : "<section><h2>Tenant setup unavailable</h2><p>Update or reinstall this extension so Auth0 can provision its managed setup client.</p></section>";
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth0 Forms MCP</title></head><body><main><h1>Auth0 Forms MCP</h1><p>This Custom Extension exposes an MCP endpoint.</p><p><code>${escapeHtml(endpoint)}</code></p><p>Connect an MCP client to this URL. The endpoint uses Auth0 Bearer authentication unless MCP_AUTH is set to off.</p>${setup}</main></body></html>`);
  });

  app.get(extensionRoutes("/health"), (_req, res) => {
    res.status(200).json({ status: "ok", runtime: process.version });
  });

  app.get(
    [
      ...extensionRoutes(protectedResourceMetadataPath),
      ...extensionRoutes(`${protectedResourceMetadataPath}/mcp`),
    ],
    (req, res, next) => {
    try {
      const config = getExtensionConfig(configReader);
      if (!config.mcpAuthEnabled) return res.status(404).end();

      const issuer = config.tenantOrigin.endsWith("/") ? config.tenantOrigin : `${config.tenantOrigin}/`;
      const metadata = new ProtectedResourceMetadataBuilder(mcpUrl(configReader, req), [issuer])
        .withResourceName("Auth0 Forms MCP")
        .build();
      return res.json(metadata);
    } catch (error) {
      return next(error);
    }
    },
  );

  if (setupAuth) {
    app.post(extensionRoutes("/setup/provision"), setupAuth.authenticate, async (req, res, next) => {
      try {
        const configuredAudience = readConfig(configReader, "AUTH0_AUDIENCE");
        const provisioned = await ensureResourceServer(configReader, configuredAudience ?? mcpUrl(configReader, req));
        return res.status(200).json({
          audience: provisioned.audience,
          issuer: tenantOriginFromConfig(configReader),
          resourceServerId: provisioned.resourceServerId,
          status: provisioned.status,
        });
      } catch (error) {
        return next(error);
      }
    });
  }

  app.all(extensionRoutes("/mcp"), async (req, res, next) => {
    try {
      const config = getExtensionConfig(configReader);
      const authentication = bearerAuth(configReader, config, req);
      const runMcp = () => {
        void handleMcpRequest(config, req, res).catch(next);
      };

      if (authentication) {
        authentication(req, res, runMcp);
      } else {
        runMcp();
      }
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    const candidateStatus =
      typeof error === "object" && error !== null
        ? (error as { status?: unknown; statusCode?: unknown }).status ??
          (error as { statusCode?: unknown }).statusCode
        : undefined;
    const status =
      typeof candidateStatus === "number" && candidateStatus >= 400 && candidateStatus <= 599
        ? candidateStatus
        : 500;
    const message = status < 500 && error instanceof Error ? error.message : "Internal Server Error";
    if (status >= 500) {
      console.error("[auth0-forms-mcp] request failed", error);
    } else {
      console.warn(`[auth0-forms-mcp] request rejected (${status})`);
    }
    if (!res.headersSent) res.status(status).json({ error: status < 500 ? "request_failed" : "internal_error", message });
  });

  return app;
}
