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
  const ascii = (value: string) => new TextEncoder().encode(value);
  const setBE16 = (bytes: Uint8Array, offset: number, value: number) => {
    bytes[offset] = (value >> 8) & 0xff;
    bytes[offset + 1] = value & 0xff;
  };
  const setBE32 = (bytes: Uint8Array, offset: number, value: number) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  const createBinaryBody = (bytes: Uint8Array) =>
    ({
      size: bytes.length,
      arrayBuffer: vi.fn(async () => bytes.buffer.slice(0)),
    }) as unknown as Blob;
  const createValidCrtBytes = () => {
    const bytes = new Uint8Array(80);
    bytes.set(ascii("C64 CARTRIDGE   "), 0);
    setBE32(bytes, 16, 64);
    setBE16(bytes, 20, 0x0100);
    bytes.set(ascii("CHIP"), 64);
    setBE32(bytes, 68, 16);
    return bytes;
  };
  const createValidSidBlob = () => {
    const bytes = new Uint8Array(0x77);
    bytes.set(ascii("PSID"), 0);
    setBE16(bytes, 4, 2);
    setBE16(bytes, 6, 0x76);
    setBE16(bytes, 14, 1);
    setBE16(bytes, 16, 1);
    bytes[0x76] = 0x60;
    return new Blob([bytes], { type: "application/octet-stream" });
  };

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

  it("keeps local PRG playback on raw ArrayBuffer uploads on web", async () => {
    const api = new C64API("http://127.0.0.1");
    const prgBytes = Uint8Array.from([0x01, 0x08, 0x60]);
    const body = createBinaryBody(prgBytes);

    await api.runPrgUpload(body);

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(request?.body as ArrayBuffer))).toEqual(Array.from(prgBytes));
  });

  it("keeps local CRT playback on raw ArrayBuffer uploads on web", async () => {
    const api = new C64API("http://127.0.0.1");
    const crtBytes = createValidCrtBytes();
    const body = createBinaryBody(crtBytes);

    await api.runCartridgeUpload(body, { filename: "local-test.crt" });

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(request?.body as ArrayBuffer))).toEqual(Array.from(crtBytes));
  });

  it("keeps local D64 playback on raw ArrayBuffer uploads on web", async () => {
    const api = new C64API("http://127.0.0.1");
    const d64Bytes = new Uint8Array(174848);
    const body = createBinaryBody(d64Bytes);

    await api.mountDriveUpload("a", body, "d64", "readwrite");

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
    expect((request?.body as ArrayBuffer).byteLength).toBe(d64Bytes.byteLength);
  });

  it("keeps local SID playback on multipart FormData so the known-good upload path stays unchanged", async () => {
    const api = new C64API("http://127.0.0.1");

    await api.playSidUpload(createValidSidBlob(), 1);

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(FormData);
  });

  it("uses File bodies for native octet-stream uploads so Capacitor patched fetch preserves binary bytes", async () => {
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = true;
    const api = new C64API("http://127.0.0.1");
    const d64Bytes = new Uint8Array(174848);
    const body = createBinaryBody(d64Bytes);

    await api.mountDriveUpload("a", body, "d64", "readwrite");

    const request = getLastRequest();
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(File);
    expect((request?.body as File).size).toBe(d64Bytes.byteLength);
    expect((request?.body as File).type).toBe("application/octet-stream");
    (globalThis as { __C64U_NATIVE_OVERRIDE__?: boolean }).__C64U_NATIVE_OVERRIDE__ = false;
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

  it("does not dedupe GET bursts when query parameters differ by address", async () => {
    const api = new C64API("http://127.0.0.1");

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (api as any).request(`/v1/machine:readmem?address=${(0xc000 + index).toString(16).toUpperCase()}`),
      ),
    );

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(20);
  });
});
