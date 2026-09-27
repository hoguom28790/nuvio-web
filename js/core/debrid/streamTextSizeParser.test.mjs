import assert from "node:assert/strict";
import { test } from "node:test";
import { sizeBytesFromStreamText, sizeBytesFromText } from "./streamTextSizeParser.js";

test("parses torrentio style size line", () => {
  const torrentioTitle = "Movie.Name.2024.1080p.WEB-DL\n👤 12 💾 1.81 GB ⚙️ ThePirateBay";
  assert.equal(sizeBytesFromText(torrentioTitle), Math.trunc(1.81 * 1024 ** 3));
});

test("parses plain sizes across units", () => {
  assert.equal(sizeBytesFromText("700 MB"), 700 * 1024 * 1024);
  assert.equal(sizeBytesFromText("1.5 TB"), Math.trunc(1.5 * 1024 ** 4));
  assert.equal(sizeBytesFromText("512KB"), 512 * 1024);
});

test("parses comma decimal separator", () => {
  assert.equal(sizeBytesFromText("💾 2,4 GB"), Math.trunc(2.4 * 1024 ** 3));
});

test("does not misread resolution year or bitrate tokens", () => {
  assert.equal(sizeBytesFromText("Movie.2024.2160p.x265.10bit"), null);
  assert.equal(sizeBytesFromText("audio 320kbps AAC"), null);
  assert.equal(sizeBytesFromText(null), null);
  assert.equal(sizeBytesFromText("  "), null);
});

test("stream text lookup prefers description then title then name", () => {
  const stream = { name: "Torrentio 4k", title: "Movie\n💾 2 GB", description: "💾 1 GB" };
  assert.equal(sizeBytesFromStreamText(stream), 1024 ** 3);

  const titleOnly = { name: "Torrentio 4k", title: "Movie\n💾 2 GB", description: null };
  assert.equal(sizeBytesFromStreamText(titleOnly), 2 * 1024 ** 3);
});
