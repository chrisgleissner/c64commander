/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const capacitorMocks = vi.hoisted(() => ({
  getPlatform: vi.fn(() => "web"),
  registerPlugin: vi.fn(<T>(_name: string, options: { web: () => T }) => options.web()),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: capacitorMocks.getPlatform },
  registerPlugin: capacitorMocks.registerPlugin,
}));

import { isBareHostname, isMdnsAvailable, resolveMdnsHost } from "@/lib/native/mdnsResolver";

describe("isBareHostname", () => {
  it("recognises bare names", () => {
    expect(isBareHostname("u64")).toBe(true);
    expect(isBareHostname("c64u")).toBe(true);
  });

  it("rejects IPv4 addresses", () => {
    expect(isBareHostname("192.168.1.13")).toBe(false);
  });

  it("rejects dotted FQDNs and IPv6", () => {
    expect(isBareHostname("u64.local")).toBe(false);
    expect(isBareHostname("fe80::1")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isBareHostname("")).toBe(false);
    expect(isBareHostname("   ")).toBe(false);
  });
});

describe("isMdnsAvailable", () => {
  beforeEach(() => {
    capacitorMocks.getPlatform.mockReset();
  });

  it("is true on android", () => {
    capacitorMocks.getPlatform.mockReturnValue("android");
    expect(isMdnsAvailable()).toBe(true);
  });

  it("is false on web and ios", () => {
    capacitorMocks.getPlatform.mockReturnValue("web");
    expect(isMdnsAvailable()).toBe(false);
    capacitorMocks.getPlatform.mockReturnValue("ios");
    expect(isMdnsAvailable()).toBe(false);
  });
});

describe("resolveMdnsHost", () => {
  beforeEach(() => {
    capacitorMocks.getPlatform.mockReset();
  });

  it("throws an actionable error on web (stub)", async () => {
    capacitorMocks.getPlatform.mockReturnValue("web");
    await expect(resolveMdnsHost("u64")).rejects.toThrow(/only available on Android/);
  });
});
