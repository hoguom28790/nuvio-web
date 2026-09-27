/**
 * Cast Photo Service
 * Automatically enriches actor and cast metadata with high-quality portrait photos
 * from Wikimedia / Wikipedia Commons (and local cache) without requiring any API keys.
 * Includes elegant fallback avatar initials with consistent deterministic color palettes.
 */

const CACHE_KEY = "nuvio_cast_photos_cache_v1";
const memoryCache = new Map();

// Initialize memory cache from sessionStorage if available
try {
  if (typeof sessionStorage !== "undefined") {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([k, v]) => {
        if (k && v) memoryCache.set(k, v);
      });
    }
  }
} catch (_) {}

function saveCache() {
  try {
    if (typeof sessionStorage !== "undefined") {
      const obj = {};
      let count = 0;
      for (const [k, v] of memoryCache.entries()) {
        if (count++ > 500) break; // keep cache footprint reasonable
        obj[k] = v;
      }
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    }
  } catch (_) {}
}

export function cleanActorName(rawName) {
  return String(rawName || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+as\s+.+$/i, "")
    .replace(/\s*\/.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getActorInitials(name) {
  const cleaned = cleanActorName(name);
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function getActorAvatarGradient(name) {
  const cleaned = cleanActorName(name);
  let hash = 0;
  for (let i = 0; i < cleaned.length; i++) {
    hash = (hash << 5) - hash + cleaned.charCodeAt(i);
    hash |= 0;
  }
  const palettes = [
    ["#2563eb", "#1d4ed8"], // blue
    ["#7c3aed", "#5b21b6"], // violet
    ["#db2777", "#9d174d"], // rose
    ["#059669", "#047857"], // emerald
    ["#d97706", "#b45309"], // amber
    ["#0891b2", "#0e7490"], // cyan
    ["#4f46e5", "#3730a3"], // indigo
    ["#c026d3", "#86198f"], // fuchsia
    ["#ea580c", "#c2410c"]  // orange
  ];
  const pair = palettes[Math.abs(hash) % palettes.length];
  return `linear-gradient(135deg, ${pair[0]} 0%, ${pair[1]} 100%)`;
}

async function queryWikipediaBatch(titles = [], endpoint = "https://en.wikipedia.org/w/api.php") {
  if (!titles.length) return {};
  try {
    const encoded = titles.map((t) => encodeURIComponent(t)).join("|");
    const url = `${endpoint}?action=query&titles=${encoded}&prop=pageimages&format=json&pithumbsize=340&origin=*`;
    const response = await fetch(url);
    if (!response.ok) return {};
    const data = await response.json();
    const pages = data?.query?.pages || {};
    const results = {};

    Object.values(pages).forEach((page) => {
      const pageTitle = page?.title;
      const thumbUrl = page?.thumbnail?.source;
      if (pageTitle && thumbUrl) {
        results[pageTitle.toLowerCase()] = thumbUrl;
      }
    });
    return results;
  } catch (error) {
    return {};
  }
}

/**
 * Enriches cast members with photos.
 * Immediately applies cached photos, then performs batch background lookups.
 * Invokes onPhotoFound(person, photoUrl) for instant real-time DOM updates.
 */
export async function enrichCastPhotos(castItems = [], { onPhotoFound } = {}) {
  if (!Array.isArray(castItems) || !castItems.length) {
    return castItems;
  }

  const missing = [];
  castItems.forEach((person) => {
    if (!person || !person.name) return;
    const cleanName = cleanActorName(person.name);
    const key = cleanName.toLowerCase();

    // 1. Check memory cache
    if (!person.photo && memoryCache.has(key)) {
      person.photo = memoryCache.get(key);
      if (typeof onPhotoFound === "function") {
        onPhotoFound(person, person.photo);
      }
    }

    if (!person.photo) {
      missing.push({ person, cleanName, key });
    }
  });

  if (!missing.length) {
    return castItems;
  }

  // 2. Query English Wikipedia in batches
  const titlesToQuery = [];
  missing.slice(0, 18).forEach(({ cleanName }) => {
    const underscored = cleanName.replace(/\s+/g, "_");
    titlesToQuery.push(underscored);
    // Also include disambiguation form (e.g. Chris_Evans_(actor))
    titlesToQuery.push(`${underscored}_(actor)`);
  });

  const enResults = await queryWikipediaBatch(titlesToQuery, "https://en.wikipedia.org/w/api.php");

  // Apply resolved photos
  const stillMissing = [];
  missing.forEach((item) => {
    const { person, cleanName, key } = item;
    const cleanLower = cleanName.toLowerCase();
    const actorLower = `${cleanLower} (actor)`;

    const foundUrl = enResults[cleanLower] || enResults[actorLower];
    if (foundUrl) {
      person.photo = foundUrl;
      memoryCache.set(key, foundUrl);
      if (typeof onPhotoFound === "function") {
        onPhotoFound(person, foundUrl);
      }
    } else {
      stillMissing.push(item);
    }
  });

  // 3. For any remaining actors (especially Vietnamese or Asian names), try vi.wikipedia.org
  if (stillMissing.length) {
    const viTitles = stillMissing.map((m) => m.cleanName.replace(/\s+/g, "_"));
    const viResults = await queryWikipediaBatch(viTitles, "https://vi.wikipedia.org/w/api.php");

    stillMissing.forEach(({ person, cleanName, key }) => {
      const cleanLower = cleanName.toLowerCase();
      const foundUrl = viResults[cleanLower];
      if (foundUrl) {
        person.photo = foundUrl;
        memoryCache.set(key, foundUrl);
        if (typeof onPhotoFound === "function") {
          onPhotoFound(person, foundUrl);
        }
      }
    });
  }

  saveCache();
  return castItems;
}
