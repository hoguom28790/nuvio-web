import { SessionStore } from "../storage/sessionStore.js";
import { AuthManager } from "../auth/authManager.js";

function toHeaderObject(headers) {
  if (!headers) {
    return {};
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

function hasHeader(headers, name) {
  const target = String(name || "").toLowerCase();
  return Object.keys(headers || {}).some((key) => String(key).toLowerCase() === target);
}

// Without a limit a stalled connection (no error, no response) leaves every
// caller waiting forever -- profile activation and Home loading included.
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

// The limit covers the time until response headers arrive; once the server
// answers, the timer is cleared so a large body is never cut off mid-read.
async function fetchWithTimeout(url, init, timeoutMs) {
  if (init.signal || !(timeoutMs > 0) || typeof AbortController !== "function") {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`Request timed out after ${timeoutMs} ms`);
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function httpRequest(url, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const includeSessionAuth = options.includeSessionAuth !== false;

  const headers = toHeaderObject(options.headers);

  if (includeSessionAuth && SessionStore.refreshToken && AuthManager.isAccessTokenExpired()) {
    await AuthManager.refreshSessionIfNeeded();
  }

  if (includeSessionAuth && SessionStore.accessToken && !hasHeader(headers, "Authorization")) {
    headers["Authorization"] = `Bearer ${SessionStore.accessToken}`;
  }

  const body = options.body;
  const hasBody = body != null && method !== "GET" && method !== "HEAD";
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
  const isSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;
  if (hasBody && !hasHeader(headers, "Content-Type") && !isFormData && !isBlob && !isSearchParams) {
    headers["Content-Type"] = "application/json";
  }

  const {
    includeSessionAuth: _ignoredIncludeSessionAuth,
    timeoutMs: requestedTimeoutMs,
    ...fetchOptions
  } = options;
  const timeoutMs =
    requestedTimeoutMs === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : Number(requestedTimeoutMs);
  const fetchInit = {
    ...fetchOptions,
    method,
    credentials: fetchOptions.credentials || "omit",
    headers
  };

  let response = await fetchWithTimeout(url, fetchInit, timeoutMs);

  if (response.status === 401 && includeSessionAuth && SessionStore.refreshToken) {
    const refreshed = await AuthManager.refreshSessionIfNeeded({ force: true });
    if (refreshed && SessionStore.accessToken) {
      const retryInit = {
        ...fetchInit,
        method,
        headers: {
          ...headers,
          Authorization: `Bearer ${SessionStore.accessToken}`
        }
      };
      response = await fetchWithTimeout(url, retryInit, timeoutMs);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text);
    error.status = response.status;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.code === "string") {
          error.code = parsed.code;
        }
        if (typeof parsed.message === "string") {
          error.detail = parsed.message;
        }
      }
    } catch (parseError) {
      // Keep raw response text in error.message when payload is not JSON.
    }
    throw error;
  }

  if (response.status === 204) {
    return null;
  }
  const text = await response.text();
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) {
    return null;
  }
  return JSON.parse(normalized);
}
