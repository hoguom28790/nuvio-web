import test from "node:test";
import assert from "node:assert/strict";

const { httpRequest } = await import("./httpClient.js");

test("a request that never answers is aborted with ETIMEDOUT", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  try {
    await assert.rejects(
      httpRequest("https://example.test/x", { includeSessionAuth: false, timeoutMs: 30 }),
      (error) => error.code === "ETIMEDOUT"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a normal response is returned and the timer does not fire afterwards", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: 1 })
  });
  try {
    const result = await httpRequest("https://example.test/x", {
      includeSessionAuth: false,
      timeoutMs: 20
    });
    assert.deepEqual(result, { ok: 1 });
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a caller supplied signal is left alone", async () => {
  const realFetch = globalThis.fetch;
  const controller = new AbortController();
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = init.signal;
    return { ok: true, status: 204, text: async () => "" };
  };
  try {
    await httpRequest("https://example.test/x", {
      includeSessionAuth: false,
      signal: controller.signal
    });
    assert.equal(seen, controller.signal);
  } finally {
    globalThis.fetch = realFetch;
  }
});
