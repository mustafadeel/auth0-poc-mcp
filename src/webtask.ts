type CreateExtensionApp = typeof import("./app").createExtensionApp;
type ExtensionApp = ReturnType<CreateExtensionApp>;

interface WebtaskContext {
  data?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  [key: string]: unknown;
}

function installFetchGlobals(): void {
  const globals = globalThis as Record<string, unknown>;
  if (globals.fetch) return;

  const nodeFetch = require("node-fetch") as {
    default?: typeof globalThis.fetch;
    Headers: typeof Headers;
    Request: typeof Request;
    Response: typeof Response;
  };

  Object.assign(globals, {
    fetch: nodeFetch.default ?? nodeFetch,
    Headers: nodeFetch.Headers,
    Request: nodeFetch.Request,
    Response: nodeFetch.Response,
  });
}

function loadCreateExtensionApp(): CreateExtensionApp {
  return (require("./app") as { createExtensionApp: CreateExtensionApp }).createExtensionApp;
}

installFetchGlobals();

function readContextValue(context: WebtaskContext, key: string): string | undefined {
  const sources = [context.data, context.secrets, context];
  for (const source of sources) {
    const value = source?.[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

const handler = (context: WebtaskContext, req: Parameters<ExtensionApp>[0], res: Parameters<ExtensionApp>[1]) => {
  const createExtensionApp = loadCreateExtensionApp();
  const app = createExtensionApp((key) => readContextValue(context, key));
  app(req, res);
};

module.exports = handler;
