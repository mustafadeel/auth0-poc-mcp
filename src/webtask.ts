import { createExtensionApp } from "./app";

interface WebtaskContext {
  data?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  [key: string]: unknown;
}

function readContextValue(context: WebtaskContext, key: string): string | undefined {
  const sources = [context.data, context.secrets, context];
  for (const source of sources) {
    const value = source?.[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

const handler = (context: WebtaskContext, req: Parameters<ReturnType<typeof createExtensionApp>>[0], res: Parameters<ReturnType<typeof createExtensionApp>>[1]) => {
  const app = createExtensionApp((key) => readContextValue(context, key));
  app(req, res);
};

module.exports = handler;
