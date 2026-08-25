type CreateExtensionApp = typeof import("./app").createExtensionApp;
type ExtensionApp = ReturnType<CreateExtensionApp>;

interface WebtaskContext {
  data?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  [key: string]: unknown;
}

function loadCreateExtensionApp(): CreateExtensionApp {
  return (require("./app") as { createExtensionApp: CreateExtensionApp }).createExtensionApp;
}

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
  const app = createExtensionApp((key) => readContextValue(context, key), req);
  app(req, res);
};

module.exports = handler;
