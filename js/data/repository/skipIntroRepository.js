import { INTRODB_API_URL } from "../../config.js";

const CACHE = new Map();

function normalizeImdbId(value = "") {
  const candidate = String(value || "")
    .trim()
    .split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function toSkipInterval(segment, type) {
  if (!segment || typeof segment !== "object") {
    return null;
  }
  const start = Number.isFinite(Number(segment.start_sec))
    ? Number(segment.start_sec)
    : Number.isFinite(Number(segment.start_ms))
      ? Number(segment.start_ms) / 1000
      : NaN;
  const end = Number.isFinite(Number(segment.end_sec))
    ? Number(segment.end_sec)
    : Number.isFinite(Number(segment.end_ms))
      ? Number(segment.end_ms) / 1000
      : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return {
    startTime: start,
    endTime: end,
    type,
    provider: "introdb"
  };
}

// TheIntroDB (https://theintrodb.org) covers movies as well as episodes and
// has credits segments. Anonymous reads, no API key. Segment times are in
// milliseconds; an end of null/0 means "until the end of the media", and a
// 0..0 segment means there is none.
const THEINTRODB_MEDIA_URL = "https://api.theintrodb.org/v3/media";
const THEINTRODB_KINDS = [
  ["intro", "intro"],
  ["recap", "recap"],
  ["credits", "outro"]
];
// Placeholder end for a segment that runs to the end of the media. The player
// replaces it with the real duration once it is known.
const OPEN_ENDED_PLACEHOLDER_SECONDS = 86400;

function toTheIntroDbIntervals(data) {
  const intervals = [];
  THEINTRODB_KINDS.forEach(([kind, type]) => {
    const raw = data?.[kind];
    const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
    list.forEach((segment) => {
      if (!segment || typeof segment !== "object") {
        return;
      }
      const startMs = Number(segment.start_ms ?? 0);
      const endMs = segment.end_ms == null ? 0 : Number(segment.end_ms);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0) {
        return;
      }
      if (startMs === 0 && endMs === 0) {
        return;
      }
      if (endMs === 0) {
        // Open-ended (credits to the end). Only meaningful after a start.
        if (startMs > 0) {
          intervals.push({
            startTime: startMs / 1000,
            endTime: OPEN_ENDED_PLACEHOLDER_SECONDS,
            openEnded: true,
            type,
            provider: "theintrodb"
          });
        }
        return;
      }
      if (endMs <= startMs) {
        return;
      }
      intervals.push({
        startTime: startMs / 1000,
        endTime: endMs / 1000,
        type,
        provider: "theintrodb"
      });
    });
  });
  return intervals;
}

async function fetchJson(url, timeoutMs = 3500) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: controller?.signal
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (_) {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function fetchIntroDbIntervals(imdbId, seasonNumber, episodeNumber) {
  const baseUrl = normalizeBaseUrl(INTRODB_API_URL);
  // IntroDB only knows episodes.
  if (!baseUrl || !imdbId || seasonNumber <= 0 || episodeNumber <= 0) {
    return [];
  }
  const url = new URL("segments", baseUrl);
  url.searchParams.set("imdb_id", imdbId);
  url.searchParams.set("season", String(seasonNumber));
  url.searchParams.set("episode", String(episodeNumber));
  const data = await fetchJson(url.toString());
  return [
    toSkipInterval(data?.intro, "intro"),
    toSkipInterval(data?.recap, "recap"),
    toSkipInterval(data?.outro, "outro")
  ].filter(Boolean);
}

async function fetchTheIntroDbIntervals(imdbId, tmdbId, seasonNumber, episodeNumber, isMovie) {
  if (!imdbId && !tmdbId) {
    return [];
  }
  if (!isMovie && (seasonNumber <= 0 || episodeNumber <= 0)) {
    return [];
  }
  const url = new URL(THEINTRODB_MEDIA_URL);
  if (imdbId) {
    url.searchParams.set("imdb_id", imdbId);
  } else {
    url.searchParams.set("tmdb_id", String(tmdbId));
  }
  if (!isMovie) {
    url.searchParams.set("season", String(seasonNumber));
    url.searchParams.set("episode", String(episodeNumber));
  }
  const data = await fetchJson(url.toString());
  return data ? toTheIntroDbIntervals(data) : [];
}

// Several sources can know the same title: IntroDB first, then TheIntroDB for
// whatever segment types IntroDB does not have (and for movies).
export function mergeSkipIntervals(...lists) {
  const merged = [];
  const seenTypes = new Set();
  lists.forEach((list) => {
    const typesInList = new Set();
    (Array.isArray(list) ? list : []).forEach((interval) => {
      if (!interval || seenTypes.has(interval.type)) {
        return;
      }
      typesInList.add(interval.type);
      merged.push(interval);
    });
    typesInList.forEach((type) => seenTypes.add(type));
  });
  return merged.sort((left, right) => left.startTime - right.startTime);
}

export const skipIntroRepository = {
  async getSkipIntervals(imdbId, season, episode, { tmdbId = 0, itemType = "series" } = {}) {
    const normalizedImdbId = normalizeImdbId(imdbId);
    const normalizedTmdbId = Number(tmdbId) > 0 ? Number(tmdbId) : 0;
    const isMovie = String(itemType || "").toLowerCase() === "movie";
    const seasonNumber = Number(season || 0);
    const episodeNumber = Number(episode || 0);
    if (!normalizedImdbId && !normalizedTmdbId) {
      return [];
    }

    const cacheKey = `${isMovie ? "movie" : "series"}:${normalizedImdbId || `tmdb${normalizedTmdbId}`}:${seasonNumber}:${episodeNumber}`;
    if (CACHE.has(cacheKey)) {
      return CACHE.get(cacheKey);
    }

    // Both sources are asked at once, each with its own short timeout, so a
    // slow or unreachable one never delays the other.
    const [introDb, theIntroDb] = await Promise.all([
      fetchIntroDbIntervals(normalizedImdbId, seasonNumber, episodeNumber).catch(() => []),
      fetchTheIntroDbIntervals(
        normalizedImdbId,
        normalizedTmdbId,
        seasonNumber,
        episodeNumber,
        isMovie
      ).catch(() => [])
    ]);
    const intervals = mergeSkipIntervals(introDb, theIntroDb);

    // Empty results are not remembered: they may only mean a source was briefly
    // unreachable, and asking again is a single small request.
    if (intervals.length) {
      CACHE.set(cacheKey, intervals);
    }
    return intervals;
  }
};
