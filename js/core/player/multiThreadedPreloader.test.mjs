import test from "node:test";
import assert from "node:assert/strict";
import { cleanM3u8Text } from "./multiThreadedPreloader.js";

const playlist = (segments, extra = "") =>
  [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:6",
    ...segments.flatMap((s) => ["#EXTINF:6.0,", s]),
    extra,
    "#EXT-X-ENDLIST"
  ]
    .filter(Boolean)
    .join("\n");

test("playlists with ordinary segment_0001 names are left untouched", () => {
  const original = playlist(["segment_0001.ts", "segment_0002.ts", "segment_0003.ts"]);
  assert.equal(cleanM3u8Text(original), original);
});

test("a small ad block is still removed with its discontinuities", () => {
  const segments = Array.from({ length: 20 }, (_, i) => `https://cdn.example/main/seg${i}.ts`);
  const lines = ["#EXTM3U", "#EXT-X-TARGETDURATION:6"];
  segments.slice(0, 10).forEach((s) => lines.push("#EXTINF:6.0,", s));
  lines.push("#EXT-X-DISCONTINUITY");
  ["https://cdn.example/convertv7/ad1.ts", "https://cdn.example/convertv7/ad2.ts"].forEach((s) =>
    lines.push("#EXTINF:4.0,", s)
  );
  lines.push("#EXT-X-DISCONTINUITY");
  segments.slice(10).forEach((s) => lines.push("#EXTINF:6.0,", s));
  lines.push("#EXT-X-ENDLIST");
  const out = cleanM3u8Text(lines.join("\n"));
  assert.doesNotMatch(out, /convertv7/);
  assert.equal(out.split("\n").filter((l) => l.endsWith(".ts")).length, 20);
});

test("a playlist that is mostly ad-like is kept as is", () => {
  const original = playlist([
    "https://cdn.example/convertv7/a.ts",
    "https://cdn.example/convertv7/b.ts",
    "https://cdn.example/main/c.ts"
  ]);
  assert.equal(cleanM3u8Text(original), original);
});

test("master playlists and non-playlists are unchanged", () => {
  assert.equal(cleanM3u8Text("plain"), "plain");
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8";
  assert.equal(cleanM3u8Text(master), master);
});

import { MultiThreadedPreloader, createMultiThreadedHlsLoader } from "./multiThreadedPreloader.js";

function fakeHls() {
  const calls = [];
  class BaseLoader {
    load(context, config, callbacks) {
      calls.push({ context, callbacks });
    }
  }
  return { Hls: { DefaultConfig: { loader: BaseLoader } }, calls };
}

test("the HLS loader stops waiting on a hung preloader download", async () => {
  const { Hls, calls } = fakeHls();
  const url = "https://cdn.example/seg1.ts";
  const preloader = {
    cache: { has: () => false },
    activeDownloads: new Map([[url, { promise: new Promise(() => {}) }]])
  };
  const Loader = createMultiThreadedHlsLoader(Hls, preloader, { waitMs: 30 });
  new Loader().load({ url, frag: { start: 0 } }, {}, { onSuccess() {} });
  assert.equal(calls.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls.length, 1);
});

test("a finished preloader download is served without a second request", async () => {
  const { Hls, calls } = fakeHls();
  const url = "https://cdn.example/seg2.ts";
  const buffer = new ArrayBuffer(8);
  const preloader = {
    cache: { has: () => false },
    activeDownloads: new Map([[url, { promise: Promise.resolve(buffer) }]])
  };
  const Loader = createMultiThreadedHlsLoader(Hls, preloader, { waitMs: 1000 });
  let delivered = null;
  new Loader().load(
    { url, frag: { start: 0 } },
    {},
    { onSuccess: (response) => (delivered = response) }
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(delivered?.data, buffer);
  assert.equal(calls.length, 0);
});

test("a preloader download that never answers is aborted and released", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  try {
    const preloader = new MultiThreadedPreloader({ downloadTimeoutMs: 30 });
    const promise = preloader.downloadFragment({ url: "https://cdn.example/seg3.ts", start: 0 });
    assert.equal(preloader.activeDownloads.size, 1);
    assert.equal(await promise, null);
    assert.equal(preloader.activeDownloads.size, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
