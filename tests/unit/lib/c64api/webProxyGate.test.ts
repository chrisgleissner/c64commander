/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { C64API } from "@/lib/c64api";
import { getAuthChallengeSnapshot, resetAuthChallengeForTests } from "@/lib/auth/authChallenge";
import { WEB_PROXY_GATE_HEADER, redirectToWebLogin, resetWebProxyGateForTests } from "@/lib/c64api/webProxyGate";
import { readFileSync } from "node:fs";
import path from "node:path";

const fetchMock = vi.fn();

const gatedResponse = (status: number, gate: string | null) =>
  new Response(JSON.stringify({ error: "gated" }), {
    status,
    headers: {
      "content-type": "application/json",
      ...(gate ? { "X-C64Commander-Gate": gate } : {}),
    },
  });

beforeEach(() => {
  Object.defineProperty(globalThis, "fetch", { value: fetchMock, configurable: true });
  fetchMock.mockReset();
  resetAuthChallengeForTests();
  resetWebProxyGateForTests();
});

afterEach(() => {
  resetAuthChallengeForTests();
});

describe("web proxy gate (HARD27-029, HARD27-030)", () => {
  it("raises the device password dialog for the device's own 401", async () => {
    fetchMock.mockResolvedValue(gatedResponse(401, null));

    const api = new C64API("http://c64u-device", undefined, "c64u-device");
    await expect(api.getInfo()).rejects.toThrow();

    expect(getAuthChallengeSnapshot()).not.toBeNull();
  });

  it("does not raise it when the web server's own session gate answered", async () => {
    fetchMock.mockResolvedValue(gatedResponse(401, "session-expired"));

    const api = new C64API("http://c64u-device", undefined, "c64u-device");
    await expect(api.getInfo()).rejects.toThrow();

    // The password the dialog asks for is the device's; no device saw this
    // request, so asking for it cannot help and the answer is never accepted.
    expect(getAuthChallengeSnapshot()).toBeNull();
  });

  it("does not raise it when the proxy refused the host by policy", async () => {
    fetchMock.mockResolvedValue(gatedResponse(403, "host-policy"));

    const api = new C64API("http://c64u-device", undefined, "c64u-device");
    await expect(api.getInfo()).rejects.toThrow();

    expect(getAuthChallengeSnapshot()).toBeNull();
  });
});

describe("web login redirect", () => {
  const makeLocation = (pathname: string) => {
    const assign = vi.fn();
    return { location: { pathname, search: "", hash: "", assign } as unknown as Location, assign };
  };

  it("carries the current route so the user returns to it after signing in", () => {
    const { location, assign } = makeLocation("/play");
    expect(redirectToWebLogin(location)).toBe(true);
    expect(assign).toHaveBeenCalledWith("/login?next=%2Fplay");
  });

  it("redirects once and never away from the login page itself", () => {
    const { location, assign } = makeLocation("/play");
    redirectToWebLogin(location);
    expect(redirectToWebLogin(location)).toBe(false);

    resetWebProxyGateForTests();
    const onLoginPage = makeLocation("/login");
    expect(redirectToWebLogin(onLoginPage.location)).toBe(false);
    expect(onLoginPage.assign).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  // The server cannot import this constant: its tsconfig roots at
  // web/server/src, so the two spellings are held together here instead.
  it("uses the header name the web server sends", () => {
    const serverSource = readFileSync(path.resolve(__dirname, "../../../../web/server/src/index.ts"), "utf8");
    expect(serverSource).toContain('const GATE_HEADER = "X-C64Commander-Gate"');
    expect(WEB_PROXY_GATE_HEADER).toBe("x-c64commander-gate");
  });
});
