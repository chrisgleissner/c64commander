/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { C64API, type ConfigResponse } from "@/lib/c64api";

describe("C64API upload bodies", () => {
  const originalFetch = globalThis.fetch;
  const createBinaryBody = (bytes: number[]) =>
    ({
      size: bytes.length,
      arrayBuffer: vi.fn(async () => Uint8Array.from(bytes).buffer),
    }) as unknown as Blob;

  const getLastRequest = () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    return fetchMock.mock.calls.at(-1)?.[1];
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200, headers: { "content-type": "text/plain" } })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("keeps local PRG playback on raw ArrayBuffer uploads so Android binary bytes are not coerced like the SID-safe multipart path", async () => {
    const api = new C64API("http://127.0.0.1");
    const body = createBinaryBody([1, 2, 3, 4]);

    await api.runPrgUpload(body);

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(request?.body as ArrayBuffer))).toEqual([1, 2, 3, 4]);
  });

  it("keeps local CRT playback on raw ArrayBuffer uploads so Android cartridge bytes stay intact", async () => {
    const api = new C64API("http://127.0.0.1");
    const body = createBinaryBody([5, 6, 7, 8]);

    await api.runCartridgeUpload(body);

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(request?.body as ArrayBuffer))).toEqual([5, 6, 7, 8]);
  });

  it("keeps local D64 playback on raw ArrayBuffer uploads so Android disk images are not corrupted in transit", async () => {
    const api = new C64API("http://127.0.0.1");
    const body = createBinaryBody([9, 10, 11, 12]);

    await api.mountDriveUpload("a", body, "d64", "readwrite");

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(request?.body as ArrayBuffer))).toEqual([9, 10, 11, 12]);
  });

  it("keeps local SID playback on multipart FormData so the known-good upload path stays unchanged", async () => {
    const api = new C64API("http://127.0.0.1");

    await api.playSidUpload(new Blob([Uint8Array.from([9, 8, 7])]), 1);

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(FormData);
  });
});

describe("C64API getConfigItems", () => {
  it("enriches scalar category items from per-item metadata responses", async () => {
    const api = new C64API("http://127.0.0.1");

    vi.spyOn(api, "getCategory").mockResolvedValue({
      "LED Strip Settings": {
        "LedStrip Mode": "Fixed Color",
        "Fixed Color": "Royal Blue",
      },
      errors: [],
    } as ConfigResponse);

    const getConfigItem = vi.spyOn(api, "getConfigItem").mockImplementation(async (_category, item) => {
      if (item === "LedStrip Mode") {
        return {
          "LED Strip Settings": {
            items: {
              "LedStrip Mode": {
                current: "Fixed Color",
                values: ["Off", "Fixed Color", "SID Music", "Rainbow"],
                default: "Fixed Color",
              },
            },
          },
          errors: [],
        } as ConfigResponse;
      }

      return {
        "LED Strip Settings": {
          items: {
            "Fixed Color": {
              current: "Royal Blue",
              values: ["Red", "Royal Blue", "White"],
              default: "Royal Blue",
            },
          },
        },
        errors: [],
      } as ConfigResponse;
    });

    const response = await api.getConfigItems("LED Strip Settings", ["LedStrip Mode", "Fixed Color"]);

    expect(response).toEqual({
      "LED Strip Settings": {
        items: {
          "LedStrip Mode": {
            current: "Fixed Color",
            values: ["Off", "Fixed Color", "SID Music", "Rainbow"],
            default: "Fixed Color",
          },
          "Fixed Color": {
            current: "Royal Blue",
            values: ["Red", "Royal Blue", "White"],
            default: "Royal Blue",
          },
        },
      },
      errors: [],
    });
    expect(getConfigItem).toHaveBeenCalledTimes(2);
    expect(getConfigItem).toHaveBeenNthCalledWith(1, "LED Strip Settings", "LedStrip Mode", {});
    expect(getConfigItem).toHaveBeenNthCalledWith(2, "LED Strip Settings", "Fixed Color", {});
  });

  it("enriches scalar audio mixer items so Home SID sliders receive real ranges and positions", async () => {
    const api = new C64API("http://127.0.0.1");

    vi.spyOn(api, "getCategory").mockResolvedValue({
      "Audio Mixer": {
        "Vol Socket 1": " 0 dB",
        "Pan Socket 1": "Left 3",
      },
      errors: [],
    } as ConfigResponse);

    const getConfigItem = vi.spyOn(api, "getConfigItem").mockImplementation(async (_category, item) => {
      if (item === "Vol Socket 1") {
        return {
          "Audio Mixer": {
            items: {
              "Vol Socket 1": {
                current: " 0 dB",
                values: ["OFF", "-1 dB", " 0 dB", "+1 dB"],
                default: " 0 dB",
              },
            },
          },
          errors: [],
        } as ConfigResponse;
      }

      return {
        "Audio Mixer": {
          items: {
            "Pan Socket 1": {
              current: "Left 3",
              values: ["Left 5", "Left 4", "Left 3", "Center", "Right 3"],
              default: "Left 3",
            },
          },
        },
        errors: [],
      } as ConfigResponse;
    });

    const response = await api.getConfigItems("Audio Mixer", ["Vol Socket 1", "Pan Socket 1"]);

    expect(response).toEqual({
      "Audio Mixer": {
        items: {
          "Vol Socket 1": {
            current: " 0 dB",
            values: ["OFF", "-1 dB", " 0 dB", "+1 dB"],
            default: " 0 dB",
          },
          "Pan Socket 1": {
            current: "Left 3",
            values: ["Left 5", "Left 4", "Left 3", "Center", "Right 3"],
            default: "Left 3",
          },
        },
      },
      errors: [],
    });
    expect(getConfigItem).toHaveBeenCalledTimes(2);
    expect(getConfigItem).toHaveBeenNthCalledWith(1, "Audio Mixer", "Vol Socket 1", {});
    expect(getConfigItem).toHaveBeenNthCalledWith(2, "Audio Mixer", "Pan Socket 1", {});
  });
});

describe("C64API request identity", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ errors: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("reuses one in-flight GET when query params are reordered but semantically equal", async () => {
    let releaseFetch!: () => void;
    const fetchBlocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await fetchBlocked;
        return new Response(JSON.stringify({ errors: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const api = new C64API("http://127.0.0.1");

    const left = (api as any).request("/v1/configs?a=1&b=2");
    const right = (api as any).request("/v1/configs?b=2&a=1");

    await Promise.resolve();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);

    releaseFetch();
    await Promise.all([left, right]);
  });

  it("does not dedupe repeated writes even when their path is identical", async () => {
    const api = new C64API("http://127.0.0.1");

    await Promise.all([
      api.updateConfigBatch({ "Audio Mixer": { "Vol Socket 1": "0 dB" } }, { immediate: true }),
      api.updateConfigBatch({ "Audio Mixer": { "Vol Socket 1": "0 dB" } }, { immediate: true }),
    ]);

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });
});
