/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { InMemoryTextBackend } from "@/lib/songlengths/inMemoryTextBackend";
import { resolveSonglengthDurationMsWithFacade } from "@/pages/playFiles/songlengthsResolution";

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
  computeSidMd5: vi.fn(async () => "dynamic-deadbeef"),
}));

import { addErrorLog } from "@/lib/logging";

const addErrorLogMock = vi.mocked(addErrorLog);

describe("resolveSonglengthDurationMsWithFacade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe("with the real in-memory backend", () => {
    const database =
      "; /DEMOS/Intro.sid\nmd5aaaa=1:00\n; /GAMES/Other.sid\nmd5bbbb=2:00\n; /MUSICIANS/A/Artist/Tune.sid\nmd5cccc=0:42";

    const makeService = async () => {
      const backend = new InMemoryTextBackend();
      await backend.load({ sourceLabel: "test", files: [{ path: "Songlengths.md5", content: database }] } as never);
      return {
        resolveDurationSeconds: (query: Parameters<InMemoryTextBackend["resolve"]>[0]) => backend.resolve(query),
      };
    };
    const makeFile = () => ({ arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) });

    it("reads no file when the virtual path is a full-path match", async () => {
      const file = makeFile();
      const result = await resolveSonglengthDurationMsWithFacade({
        service: await makeService(),
        path: "/MUSICIANS/A/Artist/Tune.sid",
        file: file as never,
        songNr: 1,
      });
      expect(result).toBe(42000);
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    });

    it("uses the md5 entry when a name-only match is hashed to a different entry", async () => {
      const result = await resolveSonglengthDurationMsWithFacade({
        service: await makeService(),
        path: "/Local/Intro.sid",
        file: makeFile() as never,
        songNr: 1,
        computeSidMd5: vi.fn(async () => "md5bbbb"),
      });
      expect(result).toBe(120000);
    });

    it("keeps the file-name length when the md5 lookup misses", async () => {
      const result = await resolveSonglengthDurationMsWithFacade({
        service: await makeService(),
        path: "/Local/Intro.sid",
        file: makeFile() as never,
        songNr: 1,
        computeSidMd5: vi.fn(async () => "md5zzzz"),
      });
      expect(result).toBe(60000);
    });

    it("keeps the file-name length and logs when hashing fails", async () => {
      const result = await resolveSonglengthDurationMsWithFacade({
        service: await makeService(),
        path: "/Local/Intro.sid",
        file: makeFile() as never,
        songNr: 1,
        computeSidMd5: vi.fn(async () => {
          throw new Error("hash failed");
        }),
      });
      expect(result).toBe(60000);
      expect(addErrorLogMock).toHaveBeenCalledWith(
        expect.stringContaining("md5"),
        expect.objectContaining({ path: "/Local/Intro.sid", error: "hash failed" }),
      );
    });

    it("accepts a file-name match without reading the file when md5 fallback is disabled", async () => {
      const file = makeFile();
      const result = await resolveSonglengthDurationMsWithFacade({
        service: await makeService(),
        path: "/Local/Intro.sid",
        file: file as never,
        songNr: 1,
        options: { allowMd5Fallback: false },
      });
      expect(result).toBe(60000);
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    });
  });

  it("skips MD5 fallback during bulk HVSC imports so songlength lookups stay lazy and throughput does not collapse", async () => {
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

  it("still allows MD5 fallback for interactive playback lookups when bulk-import throttling is not active", async () => {
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

  it("returns null when path lookup misses and no local file is available for md5 fallback", async () => {
    const service = {
      resolveDurationSeconds: vi.fn(() => ({ durationSeconds: null })),
    };

    const result = await resolveSonglengthDurationMsWithFacade({
      service,
      path: "/MUSICIANS/A/Artist/Tune.sid",
      songNr: 1,
    });

    expect(result).toBeNull();
    expect(service.resolveDurationSeconds).toHaveBeenCalledTimes(1);
  });

  it("normalizes empty paths to the root lookup path", async () => {
    const service = {
      resolveDurationSeconds: vi.fn(() => ({ durationSeconds: null })),
    };

    await resolveSonglengthDurationMsWithFacade({
      service,
      path: "",
      songNr: null,
    });

    expect(service.resolveDurationSeconds).toHaveBeenCalledWith({
      virtualPath: "/",
      fileName: "",
      songNr: null,
    });
  });

  it("uses the dynamically imported md5 helper when no override is supplied", async () => {
    const service = {
      resolveDurationSeconds: vi
        .fn()
        .mockReturnValueOnce({ durationSeconds: null })
        .mockReturnValueOnce({ durationSeconds: 64 }),
    };
    const file = {
      arrayBuffer: vi.fn(async () => Uint8Array.from([9, 8, 7]).buffer),
    };

    const result = await resolveSonglengthDurationMsWithFacade({
      service,
      path: "/MUSICIANS/A/Artist/Tune.sid",
      file: file as never,
      songNr: 3,
    });

    expect(result).toBe(64000);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(service.resolveDurationSeconds).toHaveBeenNthCalledWith(2, {
      virtualPath: "/MUSICIANS/A/Artist/Tune.sid",
      fileName: "Tune.sid",
      md5: "dynamic-deadbeef",
      songNr: 3,
    });
  });

  it("returns null when md5 fallback still cannot resolve a duration", async () => {
    const service = {
      resolveDurationSeconds: vi.fn(() => ({ durationSeconds: null })),
    };
    const file = {
      arrayBuffer: vi.fn(async () => Uint8Array.from([4, 5, 6]).buffer),
    };

    const result = await resolveSonglengthDurationMsWithFacade({
      service,
      path: "/MUSICIANS/A/Artist/Tune.sid",
      file: file as never,
      songNr: 4,
      computeSidMd5: vi.fn(async () => "still-missing"),
    });

    expect(result).toBeNull();
    expect(service.resolveDurationSeconds).toHaveBeenCalledTimes(2);
  });

  it("logs and returns null when md5 fallback throws", async () => {
    const service = {
      resolveDurationSeconds: vi.fn(() => ({ durationSeconds: null })),
    };
    const file = {
      arrayBuffer: vi.fn(async () => Uint8Array.from([1, 1, 2, 3]).buffer),
    };

    const result = await resolveSonglengthDurationMsWithFacade({
      service,
      path: "/MUSICIANS/A/Artist/Tune.sid",
      file: file as never,
      songNr: 5,
      computeSidMd5: vi.fn(async () => {
        throw new Error("md5 failed");
      }),
    });

    expect(result).toBeNull();
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Failed to resolve songlength via facade md5 fallback",
      expect.objectContaining({
        path: "/MUSICIANS/A/Artist/Tune.sid",
        songNr: 5,
        error: "md5 failed",
      }),
    );
  });
});
