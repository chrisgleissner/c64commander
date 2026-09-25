/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFallbackReporterForTests, setFallbackReporter } from "@/lib/diagnostics/fallbackReporter";
import { isActiveReachabilityHost, normalizeReachabilityHost } from "@/lib/connection/activeReachabilityHosts";

describe("normalizeReachabilityHost", () => {
  let sink: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetFallbackReporterForTests();
    sink = vi.fn();
    setFallbackReporter(sink);
  });

  afterEach(() => {
    resetFallbackReporterForTests();
  });

  it.each([null, undefined, "", "   "])("treats %j as no host at all", (value) => {
    expect(normalizeReachabilityHost(value)).toBeNull();
    expect(sink).not.toHaveBeenCalled();
  });

  it("never reports a blank host as the active device", () => {
    expect(isActiveReachabilityHost("   ")).toBe(false);
  });

  it("reports a value that carries a scheme but is not a URL and falls back to stripping the scheme", () => {
    expect(normalizeReachabilityHost("http://[C64U")).toBe("[c64u");

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toBe("activeReachabilityHosts.normalizeReachabilityHost");
    expect(sink.mock.calls[0][1]).toMatch(/^TypeError: /);
  });

  it("parses a well-formed URL without reporting a fallback", () => {
    expect(normalizeReachabilityHost("http://C64U:8080/v1/info")).toBe("c64u");
    expect(sink).not.toHaveBeenCalled();
  });
});
