/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { normalizeTransportError } from "@/lib/c64api/transportErrors";

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
