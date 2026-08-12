import type { Request, RequestHandler, Response } from "express";
import express from "express";
import { ProtectedResourceMetadataBuilder } from "@auth0/auth0-api-js";
import { createAgentComponents, type Auth0FormConfig } from "@auth0/agent-components";
import { createAuth0Verifier, subFromExtra } from "@auth0/agent-components/auth";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type ConfigReader = (key: string) => string | undefined;

const protectedResourceMetadataPath = "/.well-known/oauth-protected-resource";

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
  const tenantOrigin = readConfig(config, "AUTH0_TENANT_ORIGIN");
  const formId = readConfig(config, "FORM_ID");

  if (!tenantOrigin || tenantOrigin.includes("YOUR_TENANT")) {
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

function extensionBaseUrl(config: ConfigReader, req: Request): string {
  const configuredUrl = readConfig(config, "PUBLIC_WT_URL") ?? readConfig(config, "PUBLIC_BASE_URL");
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const protocol = req.header("x-forwarded-proto") ?? req.protocol;
  const host = req.header("x-forwarded-host") ?? req.get("host");
  if (!host) throw new Error("Unable to determine the public extension URL.");

  const pathname = req.originalUrl.split("?", 1)[0];
  const routeSuffix = ["/mcp", "/health", "/.well-known/oauth-protected-resource"].find((suffix) =>
    pathname.endsWith(suffix),
  );
  const basePath = routeSuffix ? pathname.slice(0, -routeSuffix.length) : pathname === "/" ? "" : pathname;
  return `${protocol}://${host}${basePath}`;
}

function mcpUrl(config: ConfigReader, req: Request): string {
  return `${extensionBaseUrl(config, req)}/mcp`;
}

function protectedResourceMetadataUrl(config: ConfigReader, req: Request): string {
  return `${extensionBaseUrl(config, req)}${protectedResourceMetadataPath}`;
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

  const server = new McpServer({ name: "auth0-forms-mcp-extension", version: "0.1.10" });
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

function bearerAuth(configReader: ConfigReader, config: ExtensionConfig, req: Request): RequestHandler | undefined {
  if (!config.mcpAuthEnabled) return undefined;

  const issuer = config.tenantOrigin.endsWith("/") ? config.tenantOrigin : `${config.tenantOrigin}/`;
  const endpoint = mcpUrl(configReader, req);
  const verifier = createAuth0Verifier({
    domain: config.tenantOrigin,
    audience: config.audience ?? endpoint,
  });

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

function extensionRoutes(path: string): string[] {
  return [path, `/:extensionName${path}`];
}

export function createExtensionApp(configReader: ConfigReader) {
  const app = express();
  app.use(express.json());

  app.get(extensionRoutes("/"), (req, res) => {
    const endpoint = mcpUrl(configReader, req);
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth0 Forms MCP</title></head><body><main><h1>Auth0 Forms MCP</h1><p>This Custom Extension exposes an MCP endpoint.</p><p><code>${escapeHtml(endpoint)}</code></p><p>Connect an MCP client to this URL. The endpoint uses Auth0 Bearer authentication unless MCP_AUTH is set to off.</p></main></body></html>`);
  });

  app.get(extensionRoutes("/health"), (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get(extensionRoutes(protectedResourceMetadataPath), (req, res, next) => {
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
  });

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
    const message = error instanceof Error ? error.message : String(error);
    console.error("[auth0-forms-mcp] request failed", error);
    if (!res.headersSent) res.status(500).json({ error: "internal_error", message });
  });

  return app;
}
