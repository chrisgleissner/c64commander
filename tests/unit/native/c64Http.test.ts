/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { nativeRequest } = vi.hoisted(() => ({ nativeRequest: vi.fn() }));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "android"),
  },
  CapacitorHttp: {
    request: vi.fn(),
  },
  registerPlugin: vi.fn(() => ({ request: nativeRequest })),
}));

import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { requestC64NativeHttp, type C64NativeHttpRequest } from "@/lib/native/c64Http";

const request: C64NativeHttpRequest = {
  url: "http://c64u/v1/info",
  method: "GET",
  connectTimeout: 1500,
  readTimeout: 1500,
  responseType: "json",
  requestId: "c64req-1",
  correlationId: "COR-1",
};

describe("requestC64NativeHttp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.getPlatform).mockReturnValue("android");
  });

  it("uses the Android C64 HTTP bridge for direct device traffic", async () => {
    nativeRequest.mockResolvedValue({ status: 200, data: { product: "C64 Ultimate" } });

    await expect(requestC64NativeHttp(request)).resolves.toMatchObject({ status: 200 });

    expect(nativeRequest).toHaveBeenCalledWith(request);
    expect(CapacitorHttp.request).not.toHaveBeenCalled();
  });

  it("BUG-079: preserves iOS device REST access through CapacitorHttp until an iOS bridge exists", async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue("ios");
    vi.mocked(CapacitorHttp.request).mockResolvedValue({ status: 200, data: { product: "C64 Ultimate" } } as never);

    await expect(requestC64NativeHttp(request)).resolves.toMatchObject({ status: 200 });

    expect(CapacitorHttp.request).toHaveBeenCalledWith(request);
    expect(nativeRequest).not.toHaveBeenCalled();
  });
});
