"use strict";

// Trakt OAuth device-flow bridge. Keeps TRAKT_CLIENT_SECRET on the server and
// returns only the fields the browser needs. Mirrors services/trakt-auth-bridge.
const TRAKT_API = "https://api.trakt.tv";
const DEVICE_FIELDS = ["device_code", "user_code", "verification_url", "expires_in", "interval"];
const TOKEN_FIELDS = [
  "access_token",
  "refresh_token",
  "expires_in",
  "created_at",
  "token_type",
  "scope"
];

function pick(payload, fields) {
  return Object.fromEntries(Object.entries(payload || {}).filter(([key]) => fields.includes(key)));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function createHandler({ env, fetchImpl = fetch }) {
  const clientId = String(env.TRAKT_CLIENT_ID || "").trim();
  const clientSecret = String(env.TRAKT_CLIENT_SECRET || "").trim();
  const redirectUri = String(env.TRAKT_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob").trim();
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return async function handle(req, res) {
    const origin = String(req.headers?.origin || "");
    const originAllowed = allowedOrigins.includes(origin);
    if (originAllowed) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
    res.set("Cache-Control", "no-store");
    const send = (status, body) => res.status(status).json(body);

    if (req.method === "OPTIONS") {
      if (!originAllowed) return res.status(403).end();
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type");
      res.set("Access-Control-Max-Age", "86400");
      return res.status(204).end();
    }
    // Browsers enforce CORS; this also rejects other servers' cross-origin
    // calls that carry an Origin header we do not know.
    if (origin && !originAllowed) return send(403, { error: "Origin not allowed" });

    const path = String(req.path || "/").replace(/\/+$/, "") || "/";
    if (path === "/health" && req.method === "GET") {
      return send(200, { configured: Boolean(clientId && clientSecret) });
    }
    if (!clientId || !clientSecret) {
      return send(503, { error: "Trakt browser authentication is not configured" });
    }
    if (req.method !== "POST") return send(405, { error: "Method not allowed" });

    const body = req.body && typeof req.body === "object" ? req.body : {};
    let upstreamPath;
    let payload;
    let fields;
    if (path === "/device/code") {
      upstreamPath = "/oauth/device/code";
      payload = { client_id: clientId };
      fields = DEVICE_FIELDS;
    } else if (path === "/device/token") {
      if (!isNonEmptyString(body.code)) return send(400, { error: "Missing device code" });
      upstreamPath = "/oauth/device/token";
      payload = { code: body.code.trim(), client_id: clientId, client_secret: clientSecret };
      fields = TOKEN_FIELDS;
    } else if (path === "/refresh") {
      if (!isNonEmptyString(body.refresh_token)) {
        return send(400, { error: "Missing refresh token" });
      }
      upstreamPath = "/oauth/token";
      payload = {
        refresh_token: body.refresh_token.trim(),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "refresh_token"
      };
      fields = TOKEN_FIELDS;
    } else {
      return send(404, { error: "Not found" });
    }

    try {
      const upstream = await fetchImpl(`${TRAKT_API}${upstreamPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await upstream.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!upstream.ok) {
        const retryAfter = upstream.headers?.get?.("Retry-After");
        if (retryAfter) res.set("Retry-After", retryAfter);
        return send(Math.max(400, Math.min(599, upstream.status || 502)), {
          error: String(data.error_description || data.error || "Trakt authorization failed")
        });
      }
      return send(200, pick(data, fields));
    } catch {
      return send(502, { error: "Unable to reach Trakt authorization service" });
    }
  };
}

module.exports = { createHandler };
