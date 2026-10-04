import test from "node:test";
import assert from "node:assert/strict";
import { optimizePosterUrl } from "./imageProxy.js";

test("full-size TMDB posters are reduced to a grid-sized rendition", () => {
  assert.equal(
    optimizePosterUrl("https://image.tmdb.org/t/p/original/abc.jpg"),
    "https://image.tmdb.org/t/p/w342/abc.jpg"
  );
  assert.equal(
    optimizePosterUrl("https://image.tmdb.org/t/p/w780/abc.jpg?x=1"),
    "https://image.tmdb.org/t/p/w342/abc.jpg"
  );
});

test("metahub medium and large posters use the small rendition", () => {
  assert.equal(
    optimizePosterUrl("https://images.metahub.space/poster/large/tt0111161/img"),
    "https://images.metahub.space/poster/small/tt0111161/img"
  );
  assert.equal(
    optimizePosterUrl("https://images.metahub.space/poster/small/tt0111161/img"),
    "https://images.metahub.space/poster/small/tt0111161/img"
  );
});

test("high-density screens keep a larger rendition", () => {
  const real = globalThis.devicePixelRatio;
  globalThis.devicePixelRatio = 2;
  try {
    assert.equal(
      optimizePosterUrl("https://image.tmdb.org/t/p/original/abc.jpg"),
      "https://image.tmdb.org/t/p/w500/abc.jpg"
    );
    assert.equal(
      optimizePosterUrl("https://images.metahub.space/poster/large/tt1/img"),
      "https://images.metahub.space/poster/medium/tt1/img"
    );
  } finally {
    globalThis.devicePixelRatio = real;
  }
});

test("other URLs and empty values are returned unchanged", () => {
  assert.equal(optimizePosterUrl("https://example.com/p.webp"), "https://example.com/p.webp");
  assert.equal(optimizePosterUrl("http://insecure.example/p.jpg"), "http://insecure.example/p.jpg");
  assert.equal(optimizePosterUrl(""), "");
  assert.equal(optimizePosterUrl(null), "");
  assert.equal(optimizePosterUrl("  https://example.com/a.png  "), "https://example.com/a.png");
});
