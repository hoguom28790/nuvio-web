import test from "node:test";
import assert from "node:assert/strict";

const { tmdbFetch } = await import("./tmdbService.js");

function withFetch(impl, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = realFetch;
  });
}

test("falls back to the alias host when the primary host cannot be resolved", async () => {
  const hosts = [];
  await withFetch(
    async (url) => {
      hosts.push(new URL(url).host);
      if (url.startsWith("https://api.themoviedb.org")) {
        throw new TypeError("Failed to fetch");
      }
      return { ok: true, status: 200 };
    },
    async () => {
      const response = await tmdbFetch("/find/tt1?api_key=k");
      assert.equal(response.ok, true);
    }
  );
  assert.deepEqual(hosts, ["api.themoviedb.org", "api.tmdb.org"]);
});

test("remembers the host that worked", async () => {
  const hosts = [];
  await withFetch(
    async (url) => {
      hosts.push(new URL(url).host);
      return { ok: true, status: 200 };
    },
    async () => {
      await tmdbFetch("/find/tt2?api_key=k");
    }
  );
  assert.deepEqual(hosts, ["api.tmdb.org"]);
});

test("a hung host is aborted and the next one is tried; all failing rejects", async () => {
  await withFetch(
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    async () => {
      await assert.rejects(tmdbFetch("/find/tt3?api_key=k", { timeoutMs: 20 }));
    }
  );
});

test("an HTTP error response is returned, not retried on another host", async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return { ok: false, status: 401 };
    },
    async () => {
      const response = await tmdbFetch("/find/tt4?api_key=bad");
      assert.equal(response.status, 401);
    }
  );
  assert.equal(calls, 1);
});

const { TmdbService } = await import("./tmdbService.js");

test("a TMDB id from Cinemeta meta is remembered and found without any request", () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("no network expected");
  };
  try {
    assert.equal(TmdbService.getKnownTmdbId("tt0983213", "movie"), null);
    assert.equal(TmdbService.rememberTmdbId("tt0983213", "movie", 38142), true);
    assert.equal(TmdbService.getKnownTmdbId("tt0983213", "movie"), "38142");
    // Series ids carry season/episode; movies and series are kept apart.
    assert.equal(TmdbService.rememberTmdbId("tt0944947", "series", "1399"), true);
    assert.equal(TmdbService.getKnownTmdbId("tt0944947:1:2", "series"), "1399");
    assert.equal(TmdbService.getKnownTmdbId("tt0944947", "movie"), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("invalid ids are ignored", () => {
  assert.equal(TmdbService.rememberTmdbId("kitsu:1", "movie", 5), false);
  assert.equal(TmdbService.rememberTmdbId("tt1", "movie", "abc"), false);
  assert.equal(TmdbService.rememberTmdbId("tt1", "movie", null), false);
  assert.equal(TmdbService.getKnownTmdbId("", "movie"), null);
});
