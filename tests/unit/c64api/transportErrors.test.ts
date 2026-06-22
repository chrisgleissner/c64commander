/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  getHttpStatusFromError,
  isAuthRequiredError,
  isAuthRequiredHttpStatus,
  normalizeTransportError,
} from "@/lib/c64api/transportErrors";

describe("normalizeTransportError", () => {
  it("classifies DNS / unknown-host errors", () => {
    const result = normalizeTransportError(new Error("getaddrinfo ENOTFOUND u64"), { host: "u64" });
    expect(result.class).toBe("dns");
    expect(result.userMessage).toMatch(/Couldn't resolve 'u64'/);
    expect(result.userMessage).toMatch(/IP address/);
  });

  it("classifies no-route errors", () => {
    const result = normalizeTransportError(new Error("Network is unreachable"), { host: "c64u" });
    expect(result.class).toBe("no-route");
    expect(result.userMessage).toMatch(/No route to 'c64u'/);
  });

  it("classifies connection-refused errors", () => {
    const result = normalizeTransportError(new Error("connect ECONNREFUSED 1.2.3.4:80"));
    expect(result.class).toBe("refused");
    expect(result.userMessage).toMatch(/firmware booting/);
  });

  it("classifies connection reset / EPIPE errors", () => {
    expect(normalizeTransportError(new Error("read ECONNRESET")).class).toBe("reset");
    expect(normalizeTransportError(new Error("write EPIPE")).class).toBe("reset");
  });

  it("classifies timeout / abort errors", () => {
    expect(normalizeTransportError(new Error("Request timed out")).class).toBe("timeout");
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    expect(normalizeTransportError(abortError).class).toBe("timeout");
  });

  it("classifies CORS / Failed to fetch errors", () => {
    const result = normalizeTransportError(new TypeError("Failed to fetch"), { host: "u64" });
    expect(result.class).toBe("cors");
    expect(result.userMessage).toMatch(/'u64'/);
  });

  it("falls back to unknown for unrecognised messages", () => {
    const result = normalizeTransportError(new Error("Quantum entanglement collapsed"));
    expect(result.class).toBe("unknown");
    expect(result.userMessage).toContain("Quantum");
  });

  it("handles non-Error inputs", () => {
    expect(normalizeTransportError("Failed to fetch").class).toBe("cors");
    expect(normalizeTransportError(null).class).toBe("unknown");
    expect(normalizeTransportError(undefined).class).toBe("unknown");
  });
});

describe("auth-required detection (401/403)", () => {
  it("treats 401 and 403 as auth-required and nothing else", () => {
    expect(isAuthRequiredHttpStatus(401)).toBe(true);
    expect(isAuthRequiredHttpStatus(403)).toBe(true);
    expect(isAuthRequiredHttpStatus(404)).toBe(false);
    expect(isAuthRequiredHttpStatus(500)).toBe(false);
    expect(isAuthRequiredHttpStatus(200)).toBe(false);
    expect(isAuthRequiredHttpStatus(null)).toBe(false);
    expect(isAuthRequiredHttpStatus(undefined)).toBe(false);
  });

  it("extracts the status from the annotated c64uHttpStatus (main REST path)", () => {
    const err = Object.assign(new Error("HTTP 403: Forbidden"), { c64uHttpStatus: 403 });
    expect(getHttpStatusFromError(err)).toBe(403);
    expect(isAuthRequiredError(err)).toBe(true);
  });

  it("extracts the status from the structured c64api.status field", () => {
    const err = Object.assign(new Error("Malformed JSON"), { c64api: { status: 401 } });
    expect(getHttpStatusFromError(err)).toBe(401);
    expect(isAuthRequiredError(err)).toBe(true);
  });

  it("extracts the status from a bare status field", () => {
    expect(getHttpStatusFromError({ status: 403 })).toBe(403);
    expect(isAuthRequiredError({ status: 403 })).toBe(true);
  });

  it("parses the HTTP code from the message for specialized throw sites", () => {
    // readMemory throws "readMemory failed: HTTP 403" with no annotations.
    expect(getHttpStatusFromError(new Error("readMemory failed: HTTP 403"))).toBe(403);
    expect(isAuthRequiredError(new Error("readMemory failed: HTTP 403"))).toBe(true);
    expect(isAuthRequiredError("HTTP 401: Unauthorized")).toBe(true);
  });

  it("parses the embedded HTTP code from a plain object's string message", () => {
    // A non-Error object whose only status signal is a string message: exercises
    // the message-parsing branch for objects that aren't Error instances.
    expect(getHttpStatusFromError({ message: "boom HTTP 401" })).toBe(401);
    expect(isAuthRequiredError({ message: "denied HTTP 403" })).toBe(true);
  });

  it("returns null for an object error carrying no status fields or string message", () => {
    // Reaches the terminal `return null` when none of the extraction branches
    // match: object input, numeric/absent message, non-numeric status.
    expect(getHttpStatusFromError({})).toBeNull();
    expect(getHttpStatusFromError({ message: 500 })).toBeNull();
    expect(getHttpStatusFromError({ c64api: {}, status: "nope" })).toBeNull();
  });

  it("does not flag non-auth HTTP errors or transport failures", () => {
    expect(isAuthRequiredError(new Error("HTTP 404"))).toBe(false);
    expect(isAuthRequiredError(new Error("HTTP 500: Internal Server Error"))).toBe(false);
    expect(isAuthRequiredError(new Error("Failed to fetch"))).toBe(false);
    expect(isAuthRequiredError(new TypeError("Request timed out"))).toBe(false);
    expect(getHttpStatusFromError(null)).toBeNull();
    expect(getHttpStatusFromError(undefined)).toBeNull();
    // A 4030 byte count must not be mistaken for status 403.
    expect(getHttpStatusFromError(new Error("wrote 4030 bytes"))).toBeNull();
  });
});
