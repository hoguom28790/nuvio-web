import { test } from "node:test";
import assert from "node:assert/strict";

import { isUnreleased, filterReleasedItems, hasNoReleaseInfo } from "./releaseInfoUtils.js";

const YEAR_2026 = 2026;

// Mirrors ReleaseInfoUtilsTest.kt from the Android TV app.

test("catalog release filtering uses exact timestamp", () => {
  const item = { released: "2026-07-15T15:00:00Z" };

  assert.equal(isUnreleased(item, Date.parse("2026-07-15T14:59:59Z"), YEAR_2026), true);
  assert.equal(isUnreleased(item, Date.parse("2026-07-15T15:00:00Z"), YEAR_2026), false);
});

test("catalog date only release starts at utc midnight", () => {
  const item = { released: "2026-07-15" };

  assert.equal(isUnreleased(item, Date.parse("2026-07-14T23:59:59Z"), 2026), true);
  assert.equal(isUnreleased(item, Date.parse("2026-07-15T00:00:00Z"), 2026), false);
});

test("undated item is not caught by date-based isUnreleased", () => {
  const item = { released: null };
  assert.equal(isUnreleased(item, Date.parse("2026-07-28T00:00:00Z"), 2026), false);
});

test("undated item is flagged by hasNoReleaseInfo", () => {
  assert.equal(hasNoReleaseInfo({ released: null }), true);
  assert.equal(hasNoReleaseInfo({ released: " ", releaseInfo: "" }), true);
});

test("dated items are not flagged by hasNoReleaseInfo", () => {
  assert.equal(hasNoReleaseInfo({ released: "2022-05-27" }), false);
  assert.equal(hasNoReleaseInfo({ released: null, releaseInfo: "2022" }), false);
});

// Release-year fallback, used when items only carry a releaseInfo string.

test("future release year is unreleased, current and past years are not", () => {
  assert.equal(isUnreleased({ releaseInfo: "2027" }, Date.now(), YEAR_2026), true);
  assert.equal(isUnreleased({ releaseInfo: "2026" }, Date.now(), YEAR_2026), false);
  assert.equal(isUnreleased({ releaseInfo: "2020" }, Date.now(), YEAR_2026), false);
});

test("release year range uses the first year", () => {
  assert.equal(isUnreleased({ releaseInfo: "2020-2023" }, Date.now(), YEAR_2026), false);
});

test("missing release info is treated as released", () => {
  assert.equal(isUnreleased({}, Date.now(), YEAR_2026), false);
  assert.equal(isUnreleased({ releaseInfo: "" }, Date.now(), YEAR_2026), false);
});

test("filterReleasedItems keeps the same array when nothing is filtered", () => {
  const items = [{ releaseInfo: "2020" }, { released: "2021-01-01" }];
  assert.equal(filterReleasedItems(items, Date.parse("2026-01-01T00:00:00Z"), 2026), items);
});

test("filterReleasedItems drops unreleased items", () => {
  const items = [
    { name: "old", releaseInfo: "2020" },
    { name: "future", releaseInfo: "2030" },
    { name: "dated future", released: "2030-01-01" }
  ];
  const filtered = filterReleasedItems(items, Date.parse("2026-01-01T00:00:00Z"), 2026);
  assert.deepEqual(
    filtered.map((item) => item.name),
    ["old"]
  );
});
