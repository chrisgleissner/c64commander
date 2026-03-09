/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { C64API } from "@/lib/c64api";

describe("C64API upload bodies", () => {
  const originalFetch = globalThis.fetch;

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

  it("sends raw binary uploads as ArrayBuffer payloads", async () => {
    const api = new C64API("http://127.0.0.1");
    const body = {
      size: 4,
      arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3, 4]).buffer),
    } as unknown as Blob;

    await api.runPrgUpload(body);

    const fetchMock = vi.mocked(globalThis.fetch);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(request?.body as ArrayBuffer))).toEqual([1, 2, 3, 4]);
  });

  it("keeps SID uploads on multipart FormData", async () => {
    const api = new C64API("http://127.0.0.1");

    await api.playSidUpload(new Blob([Uint8Array.from([9, 8, 7])]), 1);

    const fetchMock = vi.mocked(globalThis.fetch);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(request?.body).toBeInstanceOf(FormData);
  });
});
