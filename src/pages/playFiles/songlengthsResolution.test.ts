/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { resolveSonglengthDurationMsWithFacade } from "@/pages/playFiles/songlengthsResolution";

describe("resolveSonglengthDurationMsWithFacade", () => {
  it("uses path-based resolution before md5 fallback", async () => {
    const service = {
      resolveDurationSeconds: vi.fn(() => ({ durationSeconds: 42 })),
    };
    const file = {
      arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    };

    const result = await resolveSonglengthDurationMsWithFacade({
      service,
      path: "/MUSICIANS/A/Artist/Tune.sid",
      file: file as never,
      songNr: 1,
    });

    expect(result).toBe(42000);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it("skips md5 fallback when disabled for bulk imports", async () => {
    const service = {
      resolveDurationSeconds: vi.fn(() => ({ durationSeconds: null })),
    };
    const file = {
      arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
    };

    const result = await resolveSonglengthDurationMsWithFacade({
      service,
      path: "/MUSICIANS/A/Artist/Tune.sid",
      file: file as never,
      songNr: 1,
      options: { allowMd5Fallback: false },
    });

    expect(result).toBeNull();
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });

  it("uses md5 fallback when enabled", async () => {
    const service = {
      resolveDurationSeconds: vi
        .fn()
        .mockReturnValueOnce({ durationSeconds: null })
        .mockReturnValueOnce({ durationSeconds: 91 }),
    };
    const file = {
      arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
    };

    const result = await resolveSonglengthDurationMsWithFacade({
      service,
      path: "/MUSICIANS/A/Artist/Tune.sid",
      file: file as never,
      songNr: 2,
      computeSidMd5: vi.fn(async () => "deadbeef"),
    });

    expect(result).toBe(91000);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(service.resolveDurationSeconds).toHaveBeenCalledTimes(2);
  });
});
