/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The station asks the right songlength store.
 *
 * Reproduced on a Pixel 4 with HVSC 85 fully ingested (61,157 of 61,157 songs, zero songlength
 * syntax errors): 46 of 47 queued station tunes showed the 3:00 default and a one-second subsong of
 * `Commando.sid` was playing with the minimum set to 15 s. The station was asking the file-based
 * resolver, which looks for a `Songlengths.md5` next to the media and therefore cannot answer for
 * an HVSC virtual path. Every lookup returned null, and the queue admits an unknown length.
 */

import { describe, expect, it, vi } from "vitest";

import { createStationDurationResolver } from "@/pages/playFiles/stationDurationResolver";

const HVSC_PATH = "/MUSICIANS/H/Hubbard_Rob/Commando.sid";

describe("createStationDurationResolver", () => {
  it("asks the ingested HVSC store for an HVSC tune", async () => {
    const resolveHvscSeconds = vi.fn(async () => 1);
    const resolveFileSeconds = vi.fn(async () => null);
    const resolve = createStationDurationResolver({ resolveHvscSeconds, resolveFileSeconds });

    // The one-second subsong that was reaching the queue.
    expect(await resolve(HVSC_PATH, 3)).toBe(1);
    expect(resolveHvscSeconds).toHaveBeenCalledWith(HVSC_PATH, 3);
    // No need to consult the file-based resolver once the HVSC store has answered.
    expect(resolveFileSeconds).not.toHaveBeenCalled();
  });

  it("falls back to songlengths files when the HVSC store does not know the tune", async () => {
    const resolveHvscSeconds = vi.fn(async () => null);
    const resolveFileSeconds = vi.fn(async () => 42);
    const resolve = createStationDurationResolver({ resolveHvscSeconds, resolveFileSeconds });

    expect(await resolve("/local/mine.sid", 1)).toBe(42);
    expect(resolveFileSeconds).toHaveBeenCalledWith("/local/mine.sid", 1);
  });

  it("returns null only when neither store knows the tune", async () => {
    const resolve = createStationDurationResolver({
      resolveHvscSeconds: async () => null,
      resolveFileSeconds: async () => null,
    });

    expect(await resolve(HVSC_PATH, 1)).toBeNull();
  });

  // A store that answers NaN would otherwise be taken as a real length, and `NaN < minSeconds` is
  // false, so the tune would be admitted as though it had been checked.
  it("treats a non-finite length from either store as no answer", async () => {
    const resolveFileSeconds = vi.fn(async () => 30);
    const resolve = createStationDurationResolver({
      resolveHvscSeconds: async () => Number.NaN,
      resolveFileSeconds,
    });

    expect(await resolve(HVSC_PATH, 1)).toBe(30);
    expect(resolveFileSeconds).toHaveBeenCalled();
  });

  it("passes the subsong index through to both stores", async () => {
    const resolveHvscSeconds = vi.fn(async () => null);
    const resolveFileSeconds = vi.fn(async () => null);
    const resolve = createStationDurationResolver({ resolveHvscSeconds, resolveFileSeconds });

    await resolve(HVSC_PATH, 7);

    // A file's subsongs have different lengths, so asking about the wrong one is the same class of
    // defect as asking the wrong store.
    expect(resolveHvscSeconds).toHaveBeenCalledWith(HVSC_PATH, 7);
    expect(resolveFileSeconds).toHaveBeenCalledWith(HVSC_PATH, 7);
  });
});
