/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

const { addLog } = vi.hoisted(() => ({ addLog: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addLog }));

import { evaluateNewDeviceReachability, isLikelyIpAddress } from "@/lib/connection/addDeviceReachability";

const makeDeps = (
  probeResult: { ok: boolean; error?: string | null; deviceInfo?: unknown },
  candidates: Array<{ address: string; hostname?: string | null }> = [],
) => ({
  probe: vi.fn(async () => ({ ok: probeResult.ok, error: probeResult.error ?? null, deviceInfo: null }) as never),
  discover: vi.fn(async () => ({ candidates, scannedHosts: 0, elapsedMs: 0, unsupported: false }) as never),
});

describe("isLikelyIpAddress", () => {
  it("recognises IPv4 literals and rejects hostnames", () => {
    expect(isLikelyIpAddress("192.168.1.167")).toBe(true);
    expect(isLikelyIpAddress(" 10.0.0.1 ")).toBe(true);
    expect(isLikelyIpAddress("c64u")).toBe(false);
    expect(isLikelyIpAddress("u64.local")).toBe(false);
  });
});

describe("evaluateNewDeviceReachability", () => {
  it("returns reachable when the host answers /v1/info", async () => {
    const deps = makeDeps({ ok: true });
    const result = await evaluateNewDeviceReachability({ host: "c64u", deviceHost: "c64u:80" }, deps);
    expect(result.status).toBe("reachable");
    expect(deps.discover).not.toHaveBeenCalled();
  });

  it("treats a 401/403 as reachable-but-needs-password (does not block the save)", async () => {
    const deps = makeDeps({ ok: false, error: "HTTP 403: Forbidden" });
    const result = await evaluateNewDeviceReachability({ host: "192.168.1.167", deviceHost: "192.168.1.167:80" }, deps);
    expect(result.status).toBe("needs-password");
    expect(deps.discover).not.toHaveBeenCalled();
  });

  it("suggests the LAN IP when a hostname is unreachable but the device is found by hostname match", async () => {
    const deps = makeDeps({ ok: false, error: "Couldn't resolve 'c64u'." }, [
      { address: "192.168.1.13", hostname: "u64" },
      { address: "192.168.1.167", hostname: "c64u" },
    ]);
    const result = await evaluateNewDeviceReachability({ host: "c64u", deviceHost: "c64u:80" }, deps);
    expect(result).toEqual({ status: "unreachable", suggestedAddress: "192.168.1.167", suggestedHostname: "c64u" });
  });

  it("suggests the only discovered device when there is exactly one and no hostname match", async () => {
    const deps = makeDeps({ ok: false, error: "timed out" }, [{ address: "192.168.1.50", hostname: "ultimate" }]);
    const result = await evaluateNewDeviceReachability({ host: "myc64", deviceHost: "myc64:80" }, deps);
    expect(result.status).toBe("unreachable");
    expect((result as { suggestedAddress: string }).suggestedAddress).toBe("192.168.1.50");
  });

  it("does not guess among multiple devices without a hostname match", async () => {
    const deps = makeDeps({ ok: false, error: "timed out" }, [
      { address: "192.168.1.13", hostname: "u64" },
      { address: "192.168.1.50", hostname: "other" },
    ]);
    const result = await evaluateNewDeviceReachability({ host: "myc64", deviceHost: "myc64:80" }, deps);
    expect(result).toEqual({ status: "unreachable", suggestedAddress: null, suggestedHostname: null });
  });

  it("does not run discovery (no IP rescue) when the user already typed an IP", async () => {
    const deps = makeDeps({ ok: false, error: "no route to host" });
    const result = await evaluateNewDeviceReachability({ host: "192.168.1.200", deviceHost: "192.168.1.200:80" }, deps);
    expect(result).toEqual({ status: "unreachable", suggestedAddress: null, suggestedHostname: null });
    expect(deps.discover).not.toHaveBeenCalled();
  });

  it("HARD19-036: degrades to a plain unreachable verdict within the bound when the rescue scan never resolves", async () => {
    vi.useFakeTimers();
    addLog.mockClear();
    try {
      const deps = {
        probe: vi.fn(async () => ({ ok: false, error: "dns", deviceInfo: null }) as never),
        // Simulates the rescue scan queued behind an in-flight LAN scan on the
        // native single-thread executor — it never resolves.
        discover: vi.fn(() => new Promise<never>(() => {})),
      };

      const verdict = evaluateNewDeviceReachability({ host: "c64u", deviceHost: "c64u:80" }, deps);
      // Let the probe settle, then advance past the rescue-scan timeout bound.
      await vi.advanceTimersByTimeAsync(6000);
      const result = await verdict;

      expect(result).toEqual({ status: "unreachable", suggestedAddress: null, suggestedHostname: null });
      expect(addLog).toHaveBeenCalledWith(
        "warn",
        "Reachability IP-rescue discovery timed out",
        expect.objectContaining({ host: "c64u", timeoutMs: 6000 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to a plain unreachable verdict when discovery throws", async () => {
    addLog.mockClear();
    const deps = {
      probe: vi.fn(async () => ({ ok: false, error: "dns", deviceInfo: null }) as never),
      discover: vi.fn(async () => {
        throw new Error("scan unsupported");
      }),
    };
    const result = await evaluateNewDeviceReachability({ host: "c64u", deviceHost: "c64u:80" }, deps);
    expect(result).toEqual({ status: "unreachable", suggestedAddress: null, suggestedHostname: null });
    // Per AGENTS.md the swallowed discovery error must surface at WARN with its stack,
    // not vanish at debug level.
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Reachability IP-rescue discovery failed",
      expect.objectContaining({ host: "c64u", error: "scan unsupported", stack: expect.any(String) }),
    );
  });
});
