/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HARD27-001: the existing suites cover the two halves in isolation —
 * tests/unit/secureStorage.test.ts asserts the TypeScript layer builds the JSON
 * envelope, and tests/unit/lib/native/secureStorage.web.test.ts asserts the web
 * adapter PUTs whatever string it is handed. Neither composes them, so the
 * defect (the envelope reaching the server as its single network password) was
 * invisible. This file deliberately leaves the native module unmocked and mocks
 * fetch instead, so the value that reaches the wire is asserted.
 */
describe("secureStorage composed with the real web adapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const putBodies = () =>
    fetchMock.mock.calls
      .filter(
        ([url, options]) =>
          url === "/api/secure-storage/password" && (options as RequestInit | undefined)?.method === "PUT",
      )
      .map(([, options]) => JSON.parse((options as RequestInit).body as string) as { value: string });

  beforeEach(async () => {
    vi.stubEnv("VITE_WEB_PLATFORM", "1");
    vi.resetModules();
    localStorage.clear();
    fetchMock = vi.fn(async (_url: string, options?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => (options?.method === "GET" ? { value: null } : { ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("PUTs the plaintext device password to the server, never the envelope", async () => {
    const savedDevices = await import("@/lib/savedDevices/store");
    const secureStorage = await import("@/lib/secureStorage");
    savedDevices.resetSavedDevicesCacheForTests();
    secureStorage.resetStoredPasswordCache();

    savedDevices.addSavedDevice({
      id: "device-1",
      name: "device-1",
      host: "192.168.1.10",
      type: "C64U",
      typeSource: "INFERRED",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });
    savedDevices.selectSavedDevice("device-1");

    await secureStorage.setPasswordForDevice("device-1", "plain-secret");

    const bodies = putBodies();
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[bodies.length - 1]?.value).toBe("plain-secret");
    for (const body of bodies) {
      expect(body.value).not.toContain("passwordsByDeviceId");
    }
  });
});
