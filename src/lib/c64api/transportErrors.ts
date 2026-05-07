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
      userMessage: `Cannot resolve ${hostLabel}. On Android, prefer the device IP address.`,
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
