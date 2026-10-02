/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeNativeBase64ToArrayBuffer, NULL_BODY_HTTP_STATUSES } from "@/lib/c64api/nativeResponseBody";

const bytes = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer));

describe("decodeNativeBase64ToArrayBuffer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes an ArrayBuffer through unchanged", () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    expect(decodeNativeBase64ToArrayBuffer(buffer)).toBe(buffer);
  });

  it("builds the bytes from a plain array of numbers", () => {
    expect(bytes(decodeNativeBase64ToArrayBuffer([0, 127, 255]))).toEqual([0, 127, 255]);
  });

  it("decodes Android's line-wrapped base64 with atob", () => {
    expect(bytes(decodeNativeBase64ToArrayBuffer("AAH/\nAA=="))).toEqual([0x00, 0x01, 0xff, 0x00]);
  });

  it("decodes base64 without atob through Buffer", () => {
    vi.stubGlobal("atob", undefined);
    expect(bytes(decodeNativeBase64ToArrayBuffer("UFNJRA=="))).toEqual([0x50, 0x53, 0x49, 0x44]);
  });

  it("returns an empty body for a value it cannot decode", () => {
    expect(decodeNativeBase64ToArrayBuffer(null).byteLength).toBe(0);
    expect(decodeNativeBase64ToArrayBuffer({ data: "x" }).byteLength).toBe(0);
  });

  it("lists the statuses that may not carry a body", () => {
    expect([...NULL_BODY_HTTP_STATUSES].sort((a, b) => a - b)).toEqual([101, 103, 204, 205, 304]);
  });
});
