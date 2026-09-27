const TERMINAL_HLS_HTTP_STATUSES = new Set([400, 401, 403, 404, 410]);

export function isTerminalHlsHttpStatus(statusCode = 0) {
  return TERMINAL_HLS_HTTP_STATUSES.has(Number(statusCode || 0));
}