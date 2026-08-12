import { createExtensionApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const app = createExtensionApp((key) => process.env[key]);

app.listen(port, () => {
  console.log(`[auth0-forms-mcp] local MCP endpoint: http://localhost:${port}/mcp`);
});
