type CreateExtensionApp = typeof import("./app").createExtensionApp;
type ExtensionApp = ReturnType<CreateExtensionApp>;

interface WebtaskContext {
  data?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  [key: string]: unknown;
}

class WebtaskEvent {
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented = false;
  timeStamp = Date.now();
  type: string;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

function installWebApiGlobals(): void {
  const globals = globalThis as Record<string, unknown>;

  if (!globals.Event) globals.Event = WebtaskEvent;

  if (!globals.atob) {
    globals.atob = (value: string) => Buffer.from(value, "base64").toString("latin1");
  }

  if (!globals.btoa) {
    globals.btoa = (value: string) => Buffer.from(value, "latin1").toString("base64");
  }

  const currentCrypto = globals.crypto as { subtle?: unknown } | undefined;
  if (!currentCrypto?.subtle) {
    const nodeCrypto = require("crypto") as { webcrypto?: unknown };
    if (nodeCrypto.webcrypto) globals.crypto = nodeCrypto.webcrypto;
  }

  if (!globals.AbortController) {
    const abortController = require("abort-controller") as {
      AbortController: unknown;
      AbortSignal: unknown;
    };
    Object.assign(globals, abortController);
  }

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

installWebApiGlobals();

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
