import { getEffectiveTmdbApiKey, TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";

// api.themoviedb.org is blocked or fails DNS resolution on some networks, which
// made every plugin source fail (they need a TMDB id). The documented alias
// api.tmdb.org is tried next, and the host that worked is remembered.
const TMDB_BASE_URLS = ["https://api.themoviedb.org/3", "https://api.tmdb.org/3"];
const TMDB_REQUEST_TIMEOUT_MS = 8000;
let preferredBaseIndex = 0;

export async function tmdbFetch(pathAndQuery, { timeoutMs = TMDB_REQUEST_TIMEOUT_MS } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < TMDB_BASE_URLS.length; attempt += 1) {
    const index = (preferredBaseIndex + attempt) % TMDB_BASE_URLS.length;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(
        `${TMDB_BASE_URLS[index]}${pathAndQuery}`,
        controller ? { signal: controller.signal } : undefined
      );
      preferredBaseIndex = index;
      return response;
    } catch (error) {
      lastError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError || new Error("TMDB request failed");
}

function getContentType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

// Cinemeta (and other Stremio add-ons) return the TMDB id with a title's meta
// (`moviedb_id`). Remembering it lets sources that only need the id work on
// networks where TMDB itself is unreachable, as Stremio does.
const KNOWN_IDS_STORAGE_KEY = "nuvioKnownTmdbIds";
const KNOWN_IDS_LIMIT = 500;
let knownIds = null;

function loadKnownIds() {
  if (knownIds) return knownIds;
  knownIds = new Map();
  try {
    const raw = globalThis.localStorage?.getItem(KNOWN_IDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([key, value]) => knownIds.set(key, String(value)));
    }
  } catch (_) {
    // Storage can be unavailable (private mode, policy); memory still works.
  }
  return knownIds;
}

function knownIdKey(id, type) {
  const imdb = String(id || "")
    .trim()
    .split(":")[0]
    .split("/")[0]
    .trim();
  return /^tt\d+$/i.test(imdb) ? `${getContentType(type)}:${imdb.toLowerCase()}` : null;
}

export const TmdbService = {
  rememberTmdbId(imdbId, type, tmdbId) {
    const key = knownIdKey(imdbId, type);
    const numeric = String(tmdbId ?? "").trim();
    if (!key || !/^\d+$/.test(numeric)) return false;
    const ids = loadKnownIds();
    if (ids.get(key) === numeric) return true;
    ids.delete(key);
    ids.set(key, numeric);
    while (ids.size > KNOWN_IDS_LIMIT) {
      ids.delete(ids.keys().next().value);
    }
    try {
      globalThis.localStorage?.setItem(
        KNOWN_IDS_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(ids))
      );
    } catch (_) {
      // Best effort.
    }
    return true;
  },

  getKnownTmdbId(id, type = "movie") {
    const key = knownIdKey(id, type);
    return key ? loadKnownIds().get(key) || null : null;
  },

  async ensureTmdbId(id, type = "movie", options = {}) {
    const settings = TmdbSettingsStore.get();
    const requireEnabled = options?.requireEnabled !== false;
    const apiKey = getEffectiveTmdbApiKey();
    if ((requireEnabled && !settings.enabled) || !apiKey) {
      return null;
    }

    const rawId = String(id || "").trim();
    if (!rawId) {
      return null;
    }

    const idPart = rawId
      .replace(/^tmdb:/i, "")
      .replace(/^movie:/i, "")
      .replace(/^series:/i, "")
      .trim();
    const normalizedIdPart = idPart.split(":")[0]?.split("/")[0]?.trim() || "";

    if (/^\d+$/.test(normalizedIdPart)) {
      return normalizedIdPart;
    }

    if (!normalizedIdPart.startsWith("tt")) {
      return null;
    }

    const contentType = getContentType(type);
    let response;
    try {
      response = await tmdbFetch(
        `/find/${encodeURIComponent(normalizedIdPart)}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`
      );
    } catch (_) {
      return null;
    }
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const list = contentType === "tv" ? data.tv_results : data.movie_results;
    const first = Array.isArray(list) ? list[0] : null;
    if (!first?.id) {
      return null;
    }

    return String(first.id);
  },

  async tmdbToImdb(tmdbId, type = "movie") {
    const apiKey = getEffectiveTmdbApiKey();
    const numericId = String(tmdbId || "").trim();
    if (!apiKey || !/^\d+$/.test(numericId)) {
      return null;
    }

    const contentType = getContentType(type);
    let response;
    try {
      response = await tmdbFetch(
        `/${contentType}/${encodeURIComponent(numericId)}/external_ids?api_key=${encodeURIComponent(apiKey)}`
      );
    } catch (_) {
      return null;
    }
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const imdbId = String(data?.imdb_id || "").trim();
    return /^tt\d+$/i.test(imdbId) ? imdbId : null;
  }
};
