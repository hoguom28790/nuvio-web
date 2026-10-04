import test from "node:test";
import assert from "node:assert/strict";

const { skipIntroRepository, mergeSkipIntervals } = await import("./skipIntroRepository.js");

function stubFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const result = await handler(String(url));
    if (!result) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => result };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = real;
    }
  };
}

test("a movie is looked up on TheIntroDB by IMDb id, without season or episode", async () => {
  const stub = stubFetch(async (url) =>
    url.startsWith("https://api.theintrodb.org/")
      ? {
          intro: [{ start_ms: 5000, end_ms: 65000 }],
          credits: [{ start_ms: 5400000, end_ms: null }],
          preview: [{ start_ms: 6000000, end_ms: 6100000 }]
        }
      : null
  );
  try {
    const intervals = await skipIntroRepository.getSkipIntervals("tt0111161", null, null, {
      itemType: "movie"
    });
    assert.deepEqual(
      intervals.map((interval) => [interval.type, interval.startTime, interval.provider]),
      [
        ["intro", 5, "theintrodb"],
        ["outro", 5400, "theintrodb"]
      ]
    );
    assert.equal(intervals[0].endTime, 65);
    assert.equal(intervals[1].openEnded, true);
    assert.equal(stub.calls.length, 1);
    const url = new URL(stub.calls[0]);
    assert.equal(url.searchParams.get("imdb_id"), "tt0111161");
    assert.equal(url.searchParams.has("season"), false);
  } finally {
    stub.restore();
  }
});

test("for an episode IntroDB wins and TheIntroDB fills the missing types", async () => {
  const stub = stubFetch(async (url) => {
    if (url.startsWith("https://api.introdb.app/")) {
      return { intro: { start_sec: 10, end_sec: 70 } };
    }
    return {
      intro: [{ start_ms: 12000, end_ms: 72000 }],
      recap: [{ start_ms: 0, end_ms: 0 }],
      credits: [{ start_ms: 1300000, end_ms: 1400000 }]
    };
  });
  try {
    const intervals = await skipIntroRepository.getSkipIntervals("tt0944947", 1, 2, {
      itemType: "series"
    });
    assert.deepEqual(
      intervals.map((interval) => [interval.type, interval.provider, interval.startTime]),
      [
        ["intro", "introdb", 10],
        ["outro", "theintrodb", 1300]
      ]
    );
    const theIntroDbUrl = new URL(stub.calls.find((u) => u.includes("theintrodb")));
    assert.equal(theIntroDbUrl.searchParams.get("season"), "1");
    assert.equal(theIntroDbUrl.searchParams.get("episode"), "2");
  } finally {
    stub.restore();
  }
});

test("both sources unreachable gives no intervals and is not remembered", async () => {
  const stub = stubFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  try {
    assert.deepEqual(
      await skipIntroRepository.getSkipIntervals("tt0000001", 1, 1, { itemType: "series" }),
      []
    );
    const firstCallCount = stub.calls.length;
    assert.ok(firstCallCount >= 1);
    await skipIntroRepository.getSkipIntervals("tt0000001", 1, 1, { itemType: "series" });
    assert.equal(stub.calls.length, firstCallCount * 2);
  } finally {
    stub.restore();
  }
});

test("a TMDB id is used when there is no IMDb id; nothing is requested without either", async () => {
  const stub = stubFetch(async () => ({ intro: [{ start_ms: 1000, end_ms: 2000 }] }));
  try {
    const intervals = await skipIntroRepository.getSkipIntervals("", null, null, {
      tmdbId: 603,
      itemType: "movie"
    });
    assert.equal(intervals.length, 1);
    assert.equal(new URL(stub.calls[0]).searchParams.get("tmdb_id"), "603");
    const before = stub.calls.length;
    assert.deepEqual(
      await skipIntroRepository.getSkipIntervals("", null, null, { itemType: "movie" }),
      []
    );
    assert.equal(stub.calls.length, before);
  } finally {
    stub.restore();
  }
});

test("mergeSkipIntervals keeps the first source per type and orders by start", () => {
  const merged = mergeSkipIntervals(
    [{ type: "intro", startTime: 50 }],
    [
      { type: "outro", startTime: 900 },
      { type: "intro", startTime: 5 },
      { type: "recap", startTime: 1 }
    ]
  );
  assert.deepEqual(
    merged.map((interval) => [interval.type, interval.startTime]),
    [
      ["recap", 1],
      ["intro", 50],
      ["outro", 900]
    ]
  );
});
