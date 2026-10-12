/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { bytesToBase64 } from "@/lib/encoding/base64";

const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);

describe("bytesToBase64", () => {
  it.each([0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 0x8000 * 3 + 7])("matches the reference encoding for %i bytes", (n) => {
    const input = bytes(n);
    expect(bytesToBase64(input)).toBe(Buffer.from(input).toString("base64"));
  });

  it("encodes a second of stereo 16-bit PCM, more than any single call can take as arguments", () => {
    const pcm = bytes(48000 * 4);
    expect(bytesToBase64(pcm)).toBe(Buffer.from(pcm).toString("base64"));
  });

  it("encodes only the view it is given, not the whole underlying buffer", () => {
    const view = bytes(100).subarray(10, 20);
    expect(bytesToBase64(view)).toBe(Buffer.from(view).toString("base64"));
  });
});
