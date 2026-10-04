export function normalizeImageUrl(value = "") {
  return String(value || "").trim();
}

const TMDB_POSTER_PATTERN =
  /^(https:\/\/image\.tmdb\.org\/t\/p\/)(?:original|w1280|w780|w500|w342|w300|w185|w154|h632)(\/[^?#]+)/i;
const METAHUB_POSTER_PATTERN =
  /^(https:\/\/images\.metahub\.space\/poster\/)(?:small|medium|large)(\/)/i;

function isHighDensity() {
  return Number(globalThis.devicePixelRatio || 1) >= 1.75;
}

// Catalog grids show posters at a few hundred pixels, but some add-ons point at
// full-size images (a TMDB `original` poster is several MB). Cards only need a
// grid-sized rendition, which is a large saving over a slow connection. Only
// the two image hosts whose size path segment is a documented parameter are
// rewritten; every other URL is returned untouched.
export function optimizePosterUrl(value = "") {
  const url = normalizeImageUrl(value);
  if (!url) {
    return url;
  }
  const highDensity = isHighDensity();
  const tmdb = url.match(TMDB_POSTER_PATTERN);
  if (tmdb) {
    return `${tmdb[1]}${highDensity ? "w500" : "w342"}${tmdb[2]}`;
  }
  const metahub = url.match(METAHUB_POSTER_PATTERN);
  if (metahub) {
    return url.replace(METAHUB_POSTER_PATTERN, `$1${highDensity ? "medium" : "small"}$2`);
  }
  return url;
}
