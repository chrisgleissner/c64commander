/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { C64API, type ConfigResponse } from "@/lib/c64api";
import { clearAllConfigEnrichmentCache } from "@/lib/c64api/configEnrichmentCache";

describe("C64API setBaseUrl", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    clearAllConfigEnrichmentCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("preserves persisted config enrichment across host switches", async () => {
    const api = new C64API("http://u64", undefined, "u64");

    const requestMock = vi
      .spyOn(api as unknown as { request: <T>(path: string) => Promise<T> }, "request")
      .mockImplementation(async (path: string) => {
        if (path === "/v1/info") {
          return {
            product: "Ultimate 64 Elite",
            firmware_version: "3.14e",
            unique_id: "u64-id",
          } as Awaited<ReturnType<C64API["getInfo"]>>;
        }

        if (path === "/v1/configs/U64%20Specific%20Settings") {
          return {
            "U64 Specific Settings": {
              items: {
                "System Mode": {
                  selected: "PAL",
                  values: ["PAL", "NTSC"],
                },
              },
            },
            errors: [],
          } as ConfigResponse;
        }

        throw new Error(`Unexpected path: ${path}`);
      });

    await api.getInfo();
    await api.getCategory("U64 Specific Settings");

    expect(api.getCachedCategory("U64 Specific Settings")).toEqual({
      "U64 Specific Settings": {
        items: {
          "System Mode": {
            selected: "PAL",
            values: ["PAL", "NTSC"],
          },
        },
      },
      errors: [],
    });

    api.setBaseUrl("http://c64u");
    api.setDeviceHost("c64u");
    expect(api.getCachedCategory("U64 Specific Settings")).toBeNull();

    api.setBaseUrl("http://u64");
    api.setDeviceHost("u64");

    expect(api.getCachedCategory("U64 Specific Settings")).toEqual({
      "U64 Specific Settings": {
        items: {
          "System Mode": {
            selected: "PAL",
            values: ["PAL", "NTSC"],
          },
        },
      },
      errors: [],
    });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
