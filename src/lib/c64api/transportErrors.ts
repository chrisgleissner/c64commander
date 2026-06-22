/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type TransportErrorClass = "dns" | "no-route" | "refused" | "reset" | "timeout" | "cors" | "unknown";

export type TransportFailure = {
  class: TransportErrorClass;
  /** Concise message safe to show in OFFLINE banner / Add-Device error rows. */
  userMessage: string;
  /** Original raw message for logging / diagnostics. */
  rawMessage: string;
};

const getMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(error ?? "");
};

/**
 * Map a low-level transport failure (TypeError from fetch, AbortError, etc.)
 * into a stable category plus a short, user-actionable message. This is the
 * single place where raw `Failed to fetch` is translated into something a
 * user can act on (check WiFi, retype IP, retry).
 *
 * Used by:
 * - the OFFLINE banner reason text
 * - the diagnostics ring buffer transport entries
 * - Add-Device dialog error rows
 */
export const normalizeTransportError = (error: unknown, context: { host?: string } = {}): TransportFailure => {
  const raw = getMessage(error);
  const lower = raw.toLowerCase();
  const hostLabel = context.host ? `'${context.host}'` : "device";

  if (/(unknown host|enotfound|ename_not_found|getaddrinfo|dns lookup|cannot resolve)/i.test(lower)) {
    return {
      class: "dns",
      userMessage: `Couldn't resolve ${hostLabel}. Check the device's hostname, or use its IP address.`,
      rawMessage: raw,
    };
  }
  if (/(network is unreachable|no route to host|enetunreach|ehostunreach)/i.test(lower)) {
    return {
      class: "no-route",
      userMessage: `No route to ${hostLabel} (check WiFi).`,
      rawMessage: raw,
    };
  }
  if (/(connection refused|econnrefused)/i.test(lower)) {
    return {
      class: "refused",
      userMessage: `${hostLabel} is on the network but not responding (firmware booting?).`,
      rawMessage: raw,
    };
  }
  if (/(connection reset|econnreset|epipe|broken pipe)/i.test(lower)) {
    return {
      class: "reset",
      userMessage: "Lost connection mid-request — retrying.",
      rawMessage: raw,
    };
  }
  if (/(request timed out|timeout|aborterror|aborted|deadline exceeded)/i.test(lower)) {
    return {
      class: "timeout",
      userMessage: `${hostLabel} timed out. Check that the device is powered on.`,
      rawMessage: raw,
    };
  }
  if (/(failed to fetch|networkerror|cors|access-control)/i.test(lower)) {
    return {
      class: "cors",
      userMessage: `${hostLabel} unreachable from the WebView.`,
      rawMessage: raw,
    };
  }
  return {
    class: "unknown",
    userMessage: raw || "Unknown transport error",
    rawMessage: raw,
  };
};

/**
 * HTTP statuses an Ultimate returns when a network password is required and the
 * request was unauthenticated or wrongly authenticated. The firmware returns
 * **403 Forbidden** today; **401 Unauthorized** is handled too for forward
 * compatibility and other auth-gated firmware builds.
 */
export const AUTH_REQUIRED_HTTP_STATUSES: ReadonlySet<number> = new Set([401, 403]);

export const isAuthRequiredHttpStatus = (status: number | null | undefined): boolean =>
  status !== null && status !== undefined && AUTH_REQUIRED_HTTP_STATUSES.has(status);

const parseHttpStatusFromMessage = (message: string): number | null => {
  // Matches both "HTTP 403" / "HTTP 403: Forbidden" (request layer) and
  // "readMemory failed: HTTP 403" (specialized binary paths).
  const match = /\bHTTP\s+(\d{3})\b/i.exec(message);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
};

/**
 * Best-effort extraction of the HTTP status from any error a device call may
 * throw, regardless of which throw site produced it: the annotated
 * `c64uHttpStatus` (main REST path), the structured `c64api.status` (malformed
 * JSON), a bare `status` field, or — as a last resort — the `HTTP <code>` token
 * embedded in the message. This is the single detection chokepoint so 401/403
 * is recognised no matter how the error was constructed.
 */
export const getHttpStatusFromError = (error: unknown): number | null => {
  if (typeof error === "string") return parseHttpStatusFromMessage(error);
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    c64uHttpStatus?: unknown;
    c64api?: { status?: unknown } | null;
    status?: unknown;
    message?: unknown;
  };
  if (typeof candidate.c64uHttpStatus === "number") return candidate.c64uHttpStatus;
  if (candidate.c64api && typeof candidate.c64api === "object" && typeof candidate.c64api.status === "number") {
    return candidate.c64api.status;
  }
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.message === "string") return parseHttpStatusFromMessage(candidate.message);
  return null;
};

/**
 * True when an error from any device call means "the device requires a network
 * password" (HTTP 401/403). Used app-wide to raise a single global password
 * popup instead of patching every call site.
 */
export const isAuthRequiredError = (error: unknown): boolean => isAuthRequiredHttpStatus(getHttpStatusFromError(error));
