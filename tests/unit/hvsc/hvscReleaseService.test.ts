/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLocalStorageKey } from "@/generated/variant";
import {
  buildHvscBaselineUrl,
  buildHvscUpdateUrl,
  fetchLatestHvscVersions,
  getHvscBaseUrlOverride,
  setHvscBaseUrlOverride,
} from "@/lib/hvsc/hvscReleaseService";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

const HVSC_BASE_URL_KEY = buildLocalStorageKey("hvsc_base_url");

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => "web"),
  },
  CapacitorHttp: {
    request: vi.fn(),
  },
  registerPlugin: vi.fn(() => ({})),
}));

describe("hvscReleaseService", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("localStorage", { getItem: vi.fn() });

    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(CapacitorHttp.request).mockReset();
  });

  it("parses latest baseline and update versions", async () => {
    const html = `
      <html>
        <a href="HVSC_83-all-of-them.7z">HVSC_83-all-of-them.7z</a>
        <a href="HVSC_84-all-of-them.7z">HVSC_84-all-of-them.7z</a>
        <a href="HVSC_Update_84.7z">HVSC_Update_84.7z</a>
        <a href="HVSC_Update_85.7z">HVSC_Update_85.7z</a>
      </html>
    `;

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(html, { status: 200 }));

    const result = await fetchLatestHvscVersions("https://example.com/hvsc/");
    expect(result).toEqual({
      baselineVersion: 84,
      updateVersion: 85,
      baseUrl: "https://example.com/hvsc/",
    });
    expect(buildHvscBaselineUrl(84, result.baseUrl)).toBe("https://example.com/hvsc/HVSC_84-all-of-them.7z");
    expect(buildHvscUpdateUrl(85, result.baseUrl)).toBe("https://example.com/hvsc/HVSC_Update_85.7z");
  });

  it("defaults update version to baseline when none found", async () => {
    const html = `
      <html>
        <a href="HVSC_82-all-of-them.7z">HVSC_82-all-of-them.7z</a>
      </html>
    `;

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(html, { status: 200 }));

    const result = await fetchLatestHvscVersions("https://example.com/hvsc/");
    expect(result.baselineVersion).toBe(82);
    expect(result.updateVersion).toBe(82);
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("nope", { status: 500, statusText: "Server Error" }));

    await expect(fetchLatestHvscVersions("https://example.com/hvsc/")).rejects.toThrow(
      "HVSC release fetch failed: 500 Server Error",
    );
  });

  it("uses CapacitorHttp for native HVSC index fetches", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const html = '<a href="HVSC_90-all-of-them.7z">HVSC_90-all-of-them.7z</a>';
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: html,
      headers: {},
      url: "https://example.com/hvsc/",
    });

    const result = await fetchLatestHvscVersions("https://example.com/hvsc/");
    expect(result.baselineVersion).toBe(90);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(vi.mocked(CapacitorHttp.request)).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/hvsc/",
        method: "GET",
      }),
    );
  });

  it("handles native platform check exception", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockImplementationOnce(() => {
      throw new Error("explode");
    });
    // Should fallback to fetch (non-native)
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("<html></html>", { status: 200 }));

    await fetchLatestHvscVersions("http://foo.com");
    // If it didn't crash, it caught the error and returned false (web)
    expect(fetchMock).toHaveBeenCalled();
  });

  it("resolves base URL from localStorage if available", async () => {
    // Stub localStorage
    const getItem = vi.fn().mockReturnValue("https://stored.com/hvsc");
    vi.stubGlobal("localStorage", { getItem });

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("<html></html>", { status: 200 }));

    // Pass empty/undefined url to trigger lookup
    const result = await fetchLatestHvscVersions();

    expect(result.baseUrl).toBe("https://stored.com/hvsc/");
    expect(fetchMock).toHaveBeenCalledWith("https://stored.com/hvsc/", expect.anything());
  });

  it("throws on native HTTP error", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 404,
      data: "Not Found",
      headers: {},
      url: "",
    });

    await expect(fetchLatestHvscVersions("http://foo.com")).rejects.toThrow("HVSC release fetch failed: 404");
  });

  it("falls back to default URL when localStorage has no stored value", async () => {
    // getItem returns null → covers the if(stored) FALSE branch in resolveHvscBaseUrl
    vi.stubGlobal("localStorage", { getItem: vi.fn().mockReturnValue(null) });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("<html></html>", { status: 200 }));

    const result = await fetchLatestHvscVersions(); // no override arg
    expect(fetchMock).toHaveBeenCalled();
    expect(result.baseUrl).toBeDefined();
  });

  it("handles native response with non-string data", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    // Return object instead of string → covers the ternary FALSE branch (line 68)
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: { nested: '<a href="HVSC_91-all-of-them.7z">link</a>' },
      headers: {},
      url: "https://example.com/hvsc/",
    });

    const result = await fetchLatestHvscVersions("https://example.com/hvsc/");
    expect(result).toHaveProperty("baselineVersion");
  });

  it("handles native response with null data (nullish coalescing branch)", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    // null data → JSON.stringify(null ?? '') = JSON.stringify('') → covers the ?? branch (line 68)
    vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200,
      data: null,
      headers: {},
      url: "https://example.com/hvsc/",
    });

    const result = await fetchLatestHvscVersions("https://example.com/hvsc/");
    expect(result).toHaveProperty("baselineVersion");
  });

  describe("getHvscBaseUrlOverride", () => {
    it("returns null when no override URL is stored in localStorage", () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);
      expect(getHvscBaseUrlOverride()).toBeNull();
    });

    it("returns the normalized stored URL when an override is present", () => {
      vi.mocked(localStorage.getItem).mockReturnValue("https://custom.com/hvsc");
      expect(getHvscBaseUrlOverride()).toBe("https://custom.com/hvsc/");
    });

    it("returns the stored URL unchanged when it already has a trailing slash", () => {
      vi.mocked(localStorage.getItem).mockReturnValue("https://custom.com/hvsc/");
      expect(getHvscBaseUrlOverride()).toBe("https://custom.com/hvsc/");
    });
  });

  describe("setHvscBaseUrlOverride", () => {
    it("stores the normalized URL in localStorage", () => {
      const mockLS = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
      vi.stubGlobal("localStorage", mockLS);
      setHvscBaseUrlOverride("https://example.com/hvsc");
      expect(mockLS.setItem).toHaveBeenCalledWith(HVSC_BASE_URL_KEY, "https://example.com/hvsc/");
    });

    it("removes the stored URL when called with an empty string", () => {
      const mockLS = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
      vi.stubGlobal("localStorage", mockLS);
      setHvscBaseUrlOverride("");
      expect(mockLS.removeItem).toHaveBeenCalledWith(HVSC_BASE_URL_KEY);
    });

    it("removes the stored URL when called with null", () => {
      const mockLS = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
      vi.stubGlobal("localStorage", mockLS);
      setHvscBaseUrlOverride(null);
      expect(mockLS.removeItem).toHaveBeenCalledWith(HVSC_BASE_URL_KEY);
    });

    it("removes the stored URL when called with undefined", () => {
      const mockLS = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
      vi.stubGlobal("localStorage", mockLS);
      setHvscBaseUrlOverride(undefined);
      expect(mockLS.removeItem).toHaveBeenCalledWith(HVSC_BASE_URL_KEY);
    });
  });
});
