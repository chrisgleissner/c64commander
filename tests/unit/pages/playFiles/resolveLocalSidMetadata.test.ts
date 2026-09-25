/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

import { addErrorLog } from "@/lib/logging";
import { resolveLocalSidMetadata } from "@/pages/playFiles/resolveLocalSidMetadata";

const FALLBACK_MS = 45_000;

const psidWithSongs = (songs: number) => {
  const bytes = new Uint8Array(0x7c);
  bytes.set([0x50, 0x53, 0x49, 0x44, 0x00, 0x02, 0x00, 0x7c], 0);
  bytes[14] = (songs >> 8) & 0xff;
  bytes[15] = songs & 0xff;
  return bytes.buffer;
};

const localFile = (buffer: ArrayBuffer) => ({
  name: "Waltz.sid",
  lastModified: 0,
  arrayBuffer: async () => buffer,
});

describe("resolveLocalSidMetadata", () => {
  beforeEach(() => vi.mocked(addErrorLog).mockClear());

  it("reports an unreadable tune with no duration or tune count when there is no file, without a lookup", async () => {
    const resolveSonglength = vi.fn();

    const metadata = await resolveLocalSidMetadata(undefined, 1, FALLBACK_MS, resolveSonglength);

    expect(metadata).toEqual({ durationMs: undefined, subsongCount: undefined, readable: false });
    expect(resolveSonglength).not.toHaveBeenCalled();
  });

  it("keeps the tune count and falls back to the default duration when the songlength lookup fails, and logs why", async () => {
    const resolveSonglength = vi.fn(async () => {
      throw new Error("Songlengths index unavailable");
    });

    const metadata = await resolveLocalSidMetadata(localFile(psidWithSongs(4)), 2, FALLBACK_MS, resolveSonglength);

    expect(metadata).toEqual({ durationMs: FALLBACK_MS, subsongCount: 4, readable: true });
    expect(resolveSonglength).toHaveBeenCalledWith("/Waltz.sid", expect.objectContaining({ name: "Waltz.sid" }), 2);
    expect(addErrorLog).toHaveBeenCalledWith("Failed to resolve SID metadata", {
      error: "Songlengths index unavailable",
      file: "Waltz.sid",
    });
  });
});
