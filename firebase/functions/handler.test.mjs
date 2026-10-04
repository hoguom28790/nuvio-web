import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { createHandler } = createRequire(import.meta.url)("./handler.js");
const ORIGIN = "https://hoguom28790.github.io";

function run(handler, { method = "POST", path, body, origin = ORIGIN }) {
  const headers = {};
  const out = { status: 200, body: null, headers };
  const res = {
    set: (k, v) => ((headers[k] = v), res),
    status: (s) => ((out.status = s), res),
    json: (b) => ((out.body = b), res),
    end: () => res
  };
  return handler({ method, path, body, headers: origin ? { origin } : {} }, res).then(() => out);
}

const env = { TRAKT_CLIENT_ID: "id", TRAKT_CLIENT_SECRET: "secret", ALLOWED_ORIGINS: ORIGIN };
const okFetch =
  (payload, status = 200) =>
  async (url, init) => ({
    ok: status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
    _call: { url, body: init ? JSON.parse(init.body) : null }
  });

test("health reports configuration", async () => {
  const out = await run(createHandler({ env }), { method: "GET", path: "/health" });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { configured: true });
  const none = await run(createHandler({ env: {} }), {
    method: "GET",
    path: "/health",
    origin: null
  });
  assert.deepEqual(none.body, { configured: false });
});

test("device code returns only public fields and never the secret", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return okFetch({
      device_code: "d",
      user_code: "U",
      verification_url: "v",
      expires_in: 600,
      interval: 5,
      client_secret: "leak"
    })();
  };
  const out = await run(createHandler({ env, fetchImpl }), { path: "/device/code" });
  assert.equal(out.status, 200);
  assert.equal(out.body.user_code, "U");
  assert.equal("client_secret" in out.body, false);
  assert.deepEqual(calls[0].body, { client_id: "id" });
  assert.equal(out.headers["Access-Control-Allow-Origin"], ORIGIN);
});

test("device token and refresh forward the secret only upstream", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return okFetch({
      access_token: "a",
      refresh_token: "r",
      expires_in: 1,
      created_at: 2,
      token_type: "bearer",
      scope: "public",
      extra: 1
    })();
  };
  const handler = createHandler({ env, fetchImpl });
  const token = await run(handler, { path: "/device/token", body: { code: " abc " } });
  assert.equal(token.body.access_token, "a");
  assert.equal("extra" in token.body, false);
  assert.equal(calls[0].body.code, "abc");
  assert.equal(calls[0].body.client_secret, "secret");
  const refresh = await run(handler, { path: "/refresh", body: { refresh_token: "r" } });
  assert.equal(refresh.status, 200);
  assert.equal(calls[1].body.grant_type, "refresh_token");
  assert.equal((await run(handler, { path: "/device/token", body: {} })).status, 400);
  assert.equal((await run(handler, { path: "/refresh", body: {} })).status, 400);
});

test("pending authorization is passed through as an error status", async () => {
  const handler = createHandler({ env, fetchImpl: okFetch({ error: "pending" }, 400) });
  const out = await run(handler, { path: "/device/token", body: { code: "x" } });
  assert.equal(out.status, 400);
});

test("unknown origins and unconfigured servers are refused", async () => {
  const handler = createHandler({ env, fetchImpl: okFetch({}) });
  assert.equal(
    (await run(handler, { path: "/device/code", origin: "https://evil.example" })).status,
    403
  );
  assert.equal(
    (
      await run(handler, {
        method: "OPTIONS",
        path: "/device/code",
        origin: "https://evil.example"
      })
    ).status,
    403
  );
  assert.equal((await run(handler, { method: "OPTIONS", path: "/device/code" })).status, 204);
  assert.equal(
    (await run(createHandler({ env: {} }), { path: "/device/code", origin: null })).status,
    503
  );
  assert.equal((await run(handler, { method: "GET", path: "/device/code" })).status, 405);
  assert.equal((await run(handler, { path: "/nope" })).status, 404);
});
