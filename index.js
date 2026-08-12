const http = require("node:http");
const extension = require("./build/bundle.js");

const port = Number(process.env.PORT ?? 3000);

const server = http.createServer((req, res) => {
  const protocol = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${port}`;
  const publicUrl = process.env.PUBLIC_WT_URL ?? `${protocol}://${host}`;
  extension({ data: { ...process.env, PUBLIC_WT_URL: publicUrl } }, req, res);
});

server.listen(port, () => {
  console.log(`[auth0-forms-mcp] local MCP endpoint: http://localhost:${port}/mcp`);
});
