const metadataPath = "/.well-known/oauth-protected-resource/mcp";

function corsHeaders() {
  return {
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "mcp-session-id, www-authenticate",
  };
}

function responseWithCors(response, publicOrigin) {
  const headers = new Headers(response.headers);
  const challenge = headers.get("www-authenticate");
  if (challenge) {
    headers.set(
      "www-authenticate",
      challenge.replace(/resource_metadata="[^"]*"/, `resource_metadata="${publicOrigin}${metadataPath}"`),
    );
  }

  for (const [name, value] of Object.entries(corsHeaders())) headers.set(name, value);
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}

function metadataResponse(publicOrigin, auth0Issuer) {
  const issuer = new URL(auth0Issuer).origin;
  return Response.json(
    {
      resource: `${publicOrigin}/mcp`,
      authorization_servers: [`${issuer}/`],
      resource_name: "Auth0 Forms MCP",
    },
    { headers: { "cache-control": "no-store", ...corsHeaders() } },
  );
}

function upstreamUrl(upstreamMcpUrl, path, search) {
  const upstream = new URL(upstreamMcpUrl);
  if (path === "/health") upstream.pathname = upstream.pathname.replace(/\/mcp$/, "/health");
  upstream.search = search;
  return upstream;
}

async function proxyRequest(request, upstream, publicOrigin) {
  const headers = new Headers(request.headers);
  const publicUrl = new URL(request.url);
  headers.delete("host");
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));

  const init = { headers, method: request.method, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  return responseWithCors(await fetch(upstream, init), publicOrigin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const publicOrigin = url.origin;

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (url.pathname === metadataPath) return metadataResponse(publicOrigin, env.AUTH0_ISSUER);
    if (url.pathname === "/mcp" || url.pathname === "/health") {
      return proxyRequest(request, upstreamUrl(env.UPSTREAM_MCP_URL, url.pathname, url.search), publicOrigin);
    }

    return Response.json(
      { error: "not_found" },
      { headers: corsHeaders(), status: 404 },
    );
  },
};
