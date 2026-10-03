// Cloudflare Worker version of trakt-auth-bridge for statically hosted
// deployments (GitHub Pages). Secrets: TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET.
// Variable: ALLOWED_ORIGIN (e.g. https://<user>.github.io).
const TRAKT = "https://api.trakt.tv";
const PICK = {
  "/device/code": ["device_code", "user_code", "verification_url", "expires_in", "interval"],
  token: ["access_token", "refresh_token", "expires_in", "created_at", "token_type", "scope"]
};

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin"
    };
    const reply = (status, body) =>
      new Response(body == null ? null : JSON.stringify(body), {
        status,
        headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    if (request.method === "OPTIONS") return reply(204);

    const path = new URL(request.url).pathname.replace(/^\/api\/trakt/, "");
    const configured = Boolean(env.TRAKT_CLIENT_ID && env.TRAKT_CLIENT_SECRET);
    if (path === "/health" && request.method === "GET") return reply(200, { configured });
    if (!configured) return reply(503, { error: "Trakt browser authentication is not configured" });
    if (request.method !== "POST") return reply(405, { error: "Method not allowed" });

    let body = {};
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "Invalid request" });
    }

    let upstreamPath, payload, fields;
    if (path === "/device/code") {
      upstreamPath = "/oauth/device/code";
      payload = { client_id: env.TRAKT_CLIENT_ID };
      fields = PICK["/device/code"];
    } else if (path === "/device/token" && typeof body.code === "string" && body.code.trim()) {
      upstreamPath = "/oauth/device/token";
      payload = {
        code: body.code.trim(),
        client_id: env.TRAKT_CLIENT_ID,
        client_secret: env.TRAKT_CLIENT_SECRET
      };
      fields = PICK.token;
    } else if (
      path === "/refresh" &&
      typeof body.refresh_token === "string" &&
      body.refresh_token.trim()
    ) {
      upstreamPath = "/oauth/token";
      payload = {
        refresh_token: body.refresh_token.trim(),
        client_id: env.TRAKT_CLIENT_ID,
        client_secret: env.TRAKT_CLIENT_SECRET,
        redirect_uri: env.TRAKT_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob",
        grant_type: "refresh_token"
      };
      fields = PICK.token;
    } else {
      return reply(path.startsWith("/device") || path === "/refresh" ? 400 : 404, {
        error: "Invalid request"
      });
    }

    try {
      const upstream = await fetch(`${TRAKT}${upstreamPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return reply(upstream.status, {
          error: String(data.error_description || data.error || "Trakt authorization failed")
        });
      }
      return reply(
        200,
        Object.fromEntries(Object.entries(data).filter(([k]) => fields.includes(k)))
      );
    } catch {
      return reply(502, { error: "Unable to reach Trakt authorization service" });
    }
  }
};
