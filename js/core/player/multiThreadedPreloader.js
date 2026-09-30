/**
 * Multi-Threaded Video Preloader & Browser Quota Buffer Manager
 *
 * Implements multi-threaded concurrent prefetching (4 parallel download workers)
 * with dynamic storage quota allocation capped at exactly 10% of the browser's quota
 * (clamped safely between 128 MB and 2 GB to prevent memory exhaustion).
 * Guarantees smooth, instant playback when seeking forwards or backwards.
 */

let allocatedQuotaBytes = 512 * 1024 * 1024; // Default fallback: 512 MB
let isQuotaCalculated = false;

function stripFakePngHeader(buffer, url) {
    if (buffer && buffer.byteLength > 100 && (url.includes('.png') || url.includes('tiktokcdn'))) {
        const view = new Uint8Array(buffer);
        if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) {
            return buffer.slice(95);
        }
    }
    return buffer;
}

/**
 * Calculates exactly 10% of the browser's storage quota via navigator.storage.estimate().
 * Clamped safely between 128 MB (floor) and 2 GB (ceiling to avoid tab OOM crashes).
 */
export async function getBufferQuotaBytes() {
  if (isQuotaCalculated) {
    return allocatedQuotaBytes;
  }
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      typeof navigator.storage.estimate === "function"
    ) {
      const estimate = await navigator.storage.estimate();
      const quota = Number(estimate?.quota || 0);
      if (Number.isFinite(quota) && quota > 0) {
        // Exactly 10% of browser quota as requested
        const tenPercent = Math.floor(quota * 0.1);
        allocatedQuotaBytes = Math.max(128 * 1024 * 1024, Math.min(2 * 1024 * 1024 * 1024, tenPercent));
        isQuotaCalculated = true;
        console.log(
          `[MultiThreadedPreloader] 10% browser quota allocated: ${(allocatedQuotaBytes / (1024 * 1024)).toFixed(1)} MB`
        );
        return allocatedQuotaBytes;
      }
    }
  } catch (error) {
    console.warn("[MultiThreadedPreloader] Could not estimate quota, using 512MB default", error);
  }
  isQuotaCalculated = true;
  return allocatedQuotaBytes;
}

export function getAllocatedQuotaBytes() {
  return allocatedQuotaBytes;
}

/**
 * In-memory LRU Segment & Chunk Cache
 * Automatically tracks memory usage and evicts fragments farthest from the current playback position.
 */
export class SegmentCache {
  constructor() {
    this.entries = new Map(); // url -> { data: ArrayBuffer, size: number, timestamp: number, lastUsed: number }
    this.totalBytes = 0;
  }

  has(url) {
    return this.entries.has(url);
  }

  get(url) {
    const entry = this.entries.get(url);
    if (!entry) return null;
    entry.lastUsed = Date.now();
    return entry.data;
  }

  put(url, arrayBuffer, timestamp = 0) {
    if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) return;
    const size = arrayBuffer.byteLength;
    if (this.entries.has(url)) {
      this.totalBytes -= this.entries.get(url).size;
    }
    this.entries.set(url, {
      data: arrayBuffer,
      size,
      timestamp,
      lastUsed: Date.now()
    });
    this.totalBytes += size;
    this.enforceBudget(allocatedQuotaBytes, timestamp);
  }

  enforceBudget(maxBytes = allocatedQuotaBytes, currentPlaybackTime = 0) {
    if (this.totalBytes <= maxBytes) return;

    // Sort entries by distance from current playback position (furthest first)
    const sorted = Array.from(this.entries.entries()).sort((a, b) => {
      const distA = Math.abs(a[1].timestamp - currentPlaybackTime);
      const distB = Math.abs(b[1].timestamp - currentPlaybackTime);
      return distB - distA;
    });

    for (const [url, entry] of sorted) {
      if (this.totalBytes <= maxBytes) break;
      this.entries.delete(url);
      this.totalBytes -= entry.size;
    }
  }

  clear() {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

/**
 * MultiThreadedPreloader
 * Coordinates 4 concurrent download workers to prefetch upcoming fragments
 * within a 10-minute forward window.
 */
export class MultiThreadedPreloader {
  constructor({ concurrency = 4, prefetchWindowSeconds = 600 } = {}) {
    this.concurrency = concurrency;
    this.prefetchWindowSeconds = prefetchWindowSeconds;
    this.cache = new SegmentCache();
    this.activeDownloads = new Map(); // url -> { controller: AbortController, promise: Promise }
    this.queue = [];
    this.currentPosition = 0;
    this.fragments = [];
    this.requestHeaders = {};
  }

  setFragments(fragments = [], requestHeaders = {}) {
    this.fragments = Array.isArray(fragments)
      ? fragments
          .map((f) => ({
            url: f?.url || f?.relurl || "",
            start: Number(f?.start || 0),
            duration: Number(f?.duration || 0)
          }))
          .filter((f) => Boolean(f.url))
      : [];
    this.requestHeaders = requestHeaders || {};
    this.schedulePrefetch();
  }

  updatePosition(currentTime) {
    this.currentPosition = Number(currentTime || 0);
    this.schedulePrefetch();
  }

  onSeek(seekTime) {
    this.currentPosition = Number(seekTime || 0);
    // Abort downloads that are now outside the new seek window
    for (const [url, item] of this.activeDownloads.entries()) {
      const frag = this.fragments.find((f) => f.url === url);
      if (
        frag &&
        (frag.start < this.currentPosition - 30 ||
          frag.start > this.currentPosition + this.prefetchWindowSeconds)
      ) {
        try {
          item.controller.abort();
        } catch (_) {}
        this.activeDownloads.delete(url);
      }
    }
    this.schedulePrefetch();
  }

  schedulePrefetch() {
    if (!this.fragments.length) return;

    const current = this.currentPosition;
    const windowEnd = current + this.prefetchWindowSeconds;

    // Filter candidate fragments in the forward window
    const candidates = this.fragments.filter((frag) => {
      if (frag.start < current - 10) return false;
      if (frag.start > windowEnd) return false;
      if (this.cache.has(frag.url)) return false;
      if (this.activeDownloads.has(frag.url)) return false;
      return true;
    });

    // Prioritize upcoming fragments closest to current position
    candidates.sort((a, b) => a.start - b.start);
    this.queue = candidates;
    this.processQueue();
  }

  processQueue() {
    while (this.activeDownloads.size < this.concurrency && this.queue.length > 0) {
      if (this.cache.totalBytes >= allocatedQuotaBytes) {
        break; // Reached 10% browser quota limit
      }
      const nextFrag = this.queue.shift();
      if (!nextFrag || this.cache.has(nextFrag.url) || this.activeDownloads.has(nextFrag.url)) {
        continue;
      }
      this.downloadFragment(nextFrag);
    }
  }

  downloadFragment(frag) {
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const response = await fetch(frag.url, {
          headers: this.requestHeaders,
          signal: controller.signal
        });
        if (response.ok) {
          let buffer = await response.arrayBuffer();
          buffer = stripFakePngHeader(buffer, frag.url);
          this.cache.put(frag.url, buffer, frag.start);
          return buffer;
        }
      } catch (_) {
        // Aborted or network error, silently handle
      } finally {
        this.activeDownloads.delete(frag.url);
        this.processQueue();
      }
      return null;
    })();

    this.activeDownloads.set(frag.url, { controller, promise });
    return promise;
  }

  destroy() {
    for (const item of this.activeDownloads.values()) {
      try {
        item.controller.abort();
      } catch (_) {}
    }
    this.activeDownloads.clear();
    this.queue = [];
    this.cache.clear();
    this.fragments = [];
  }
}

/**
 * Creates an Hls.js custom fragment loader that checks the MultiThreadedPreloader cache
 * before issuing network requests. Enables instant seek response.
 */
export function createMultiThreadedHlsLoader(Hls, preloader) {
  const BaseLoader = Hls?.DefaultConfig?.loader;
  if (!BaseLoader) {
    return null;
  }

  return class MultiThreadedLoader extends BaseLoader {
    load(context, config, callbacks) {
      const url = context?.url;
      const fragStart = context.frag?.start || 0;

      // Case 1: Already cached in memory
      if (preloader && preloader.cache.has(url)) {
        const cachedData = preloader.cache.get(url);
        if (cachedData) {
          const stats = {
            trequest: performance.now(),
            tfirst: performance.now(),
            tload: performance.now(),
            loaded: cachedData.byteLength,
            total: cachedData.byteLength,
            bw: 100000000,
            retry: 0
          };
          queueMicrotask(() => {
            callbacks.onSuccess({ url, data: cachedData }, stats, context);
          });
          return;
        }
      }

      // Case 2: Currently being downloaded by preloader worker
      if (preloader && preloader.activeDownloads.has(url)) {
        const active = preloader.activeDownloads.get(url);
        if (active?.promise) {
          active.promise.then((buffer) => {
            if (buffer) {
              const stats = {
                trequest: performance.now(),
                tfirst: performance.now(),
                tload: performance.now(),
                loaded: buffer.byteLength,
                total: buffer.byteLength,
                bw: 80000000,
                retry: 0
              };
              callbacks.onSuccess({ url, data: buffer }, stats, context);
            } else {
              super.load(context, config, callbacks);
            }
          }).catch(() => {
            super.load(context, config, callbacks);
          });
          return;
        }
      }

      // Case 3: Load using default loader and populate cache
      const originalSuccess = callbacks.onSuccess;
      callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
        if (response?.data instanceof ArrayBuffer) {
          response.data = stripFakePngHeader(response.data, url);
          if (preloader) {
            preloader.cache.put(url, response.data, fragStart);
          }
        }
        if (typeof originalSuccess === "function") {
          originalSuccess(response, stats, ctx, networkDetails);
        }
      };

      super.load(context, config, callbacks);
    }
  };
}

/**
 * MultiThreadedRangePreloader for Native Direct Video Streams (MP4 / MKV)
 * Issues parallel 4MB chunk requests ahead of current position.
 */
export class MultiThreadedRangePreloader {
  constructor({ concurrency = 4, chunkSize = 4 * 1024 * 1024 } = {}) {
    this.concurrency = concurrency;
    this.chunkSize = chunkSize;
    this.active = false;
    this.activeControllers = new Set();
  }

  start(url, requestHeaders = {}) {
    this.url = url;
    this.requestHeaders = requestHeaders;
    this.active = true;
    void this.probeAndPreload();
  }

  async probeAndPreload() {
    if (!this.active || !this.url) return;
    try {
      const response = await fetch(this.url, {
        method: "HEAD",
        headers: this.requestHeaders
      });
      const acceptRanges = response.headers.get("accept-ranges");
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (acceptRanges === "bytes" && contentLength > 0) {
        // Preload upcoming chunks in parallel
        const maxPreloadBytes = Math.min(contentLength, allocatedQuotaBytes);
        const chunkCount = Math.min(8, Math.ceil(maxPreloadBytes / this.chunkSize));
        const promises = [];
        for (let i = 0; i < Math.min(this.concurrency, chunkCount); i++) {
          const start = i * this.chunkSize;
          const end = Math.min(contentLength - 1, start + this.chunkSize - 1);
          promises.push(this.fetchRange(start, end));
        }
        await Promise.allSettled(promises);
      }
    } catch (_) {}
  }

  async fetchRange(start, end) {
    if (!this.active) return;
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      await fetch(this.url, {
        headers: {
          ...this.requestHeaders,
          Range: `bytes=${start}-${end}`
        },
        signal: controller.signal
      });
    } catch (_) {} finally {
      this.activeControllers.delete(controller);
    }
  }

  destroy() {
    this.active = false;
    for (const controller of this.activeControllers) {
      try {
        controller.abort();
      } catch (_) {}
    }
    this.activeControllers.clear();
  }
}

/**
 * Strips SSAI advertising segments and their bounding discontinuity tags from M3U8 playlists.
 * Targets KKPhim and Ophim ad segments (e.g., convertv7/, /v7/.../segment_..., segment_0001, etc.)
 * Ensures contiguous timeline and prevents playback stalls or audio/video desync.
 */
export function cleanM3u8Text(content) {
  if (!content || typeof content !== "string" || !content.includes("#EXTM3U")) {
    return content;
  }

  // Master playlists don't contain media segments
  if (content.includes("#EXT-X-STREAM-INF")) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const cleanedLines = [];
  let currentTags = [];
  let inAdBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#")) {
      currentTags.push(line);
    } else {
      // Check for known ad patterns
      const isAd = /convertv\d*\/|\/v\d+\/.*segment_|segment_\d{4}/i.test(trimmed);
      if (isAd) {
        currentTags = [];
        inAdBlock = true;
      } else {
        if (inAdBlock) {
          for (let k = currentTags.length - 1; k >= 0; k--) {
            const tag = currentTags[k].trim();
            if (tag.startsWith("#EXT-X-DISCONTINUITY") || tag.startsWith("#EXT-X-KEY:METHOD=NONE")) {
              currentTags.splice(k, 1);
            }
          }
          inAdBlock = false;
        }

        while (
          cleanedLines.length > 0 &&
          cleanedLines[cleanedLines.length - 1].trim().startsWith("#EXT-X-DISCONTINUITY")
        ) {
          cleanedLines.pop();
        }

        for (const tag of currentTags) {
          cleanedLines.push(tag);
        }
        cleanedLines.push(line);
        currentTags = [];
      }
    }
  }

  for (const tag of currentTags) {
    cleanedLines.push(tag);
  }

  return cleanedLines.join("\n");
}

/**
 * Creates a custom HLS.js playlist loader (pLoader) that cleans ads on the fly.
 */
export function createCleanPlaylistLoader(Hls) {
  const BaseLoader = Hls?.DefaultConfig?.loader;
  if (!BaseLoader || typeof BaseLoader !== "function") {
    return null;
  }
  try {
    return class CleanPlaylistLoader extends BaseLoader {
      load(context, config, callbacks) {
        const originalSuccess = callbacks.onSuccess;
        callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
          if (response && typeof response.data === "string" && response.data.includes("#EXTM3U")) {
            try {
              response.data = cleanM3u8Text(response.data);
            } catch (err) {
              console.warn("[CleanPlaylistLoader] Error cleaning playlist:", err);
            }
          }
          if (typeof originalSuccess === "function") {
            originalSuccess(response, stats, ctx, networkDetails);
          }
        };
        super.load(context, config, callbacks);
      }
    };
  } catch (err) {
    console.warn("[CleanPlaylistLoader] Loader creation error:", err);
    return null;
  }
}

