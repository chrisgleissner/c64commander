import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearArchivePlaybackCacheForTests,
  getCachedArchivePlayback,
  setCachedArchivePlayback,
} from "@/lib/archive/archivePlaybackCache";
import type { ArchivePlaylistReference } from "@/lib/archive/types";

const buildReference = (entryId: number): ArchivePlaylistReference => ({
  sourceId: "archive-commoserve",
  resultId: "100",
  category: 40,
  entryId,
  entryPath: `song-${entryId}.sid`,
});

const buildPlayback = (name: string) => ({
  category: "sid" as const,
  path: name,
  file: {
    name,
    lastModified: 0,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
  } as File,
});

describe("archivePlaybackCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-30T12:00:00Z"));
    clearArchivePlaybackCacheForTests();
  });

  afterEach(() => {
    clearArchivePlaybackCacheForTests();
    vi.useRealTimers();
  });

  it("returns a cached archive playback entry before the ttl elapses", () => {
    const reference = buildReference(1);
    setCachedArchivePlayback(reference, buildPlayback("joyride.sid"));

    vi.advanceTimersByTime(10 * 60 * 1000 - 1);

    expect(getCachedArchivePlayback(reference)).toEqual(
      expect.objectContaining({
        path: "joyride.sid",
      }),
    );
  });

  it("expires cached archive playback entries after the ttl elapses", () => {
    const reference = buildReference(1);
    setCachedArchivePlayback(reference, buildPlayback("joyride.sid"));

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);

    expect(getCachedArchivePlayback(reference)).toBeNull();
  });

  it("returns null for a reference that was never cached", () => {
    expect(getCachedArchivePlayback(buildReference(99))).toBeNull();
  });

  it("promotes an existing entry to the most-recently-used position on update", () => {
    for (let entryId = 1; entryId <= 100; entryId += 1) {
      setCachedArchivePlayback(buildReference(entryId), buildPlayback(`song-${entryId}.sid`));
    }
    // Re-set entry 1 (oldest). This should promote it so entry 2 becomes oldest.
    setCachedArchivePlayback(buildReference(1), buildPlayback("joyride.sid"));
    // Adding one more entry should now evict entry 2 (the new oldest).
    setCachedArchivePlayback(buildReference(101), buildPlayback("song-101.sid"));

    expect(getCachedArchivePlayback(buildReference(2))).toBeNull();
    expect(getCachedArchivePlayback(buildReference(1))).toEqual(expect.objectContaining({ path: "joyride.sid" }));
  });

  it("evicts the oldest cached archive playback entry when capacity is exceeded", () => {
    for (let entryId = 1; entryId <= 101; entryId += 1) {
      setCachedArchivePlayback(buildReference(entryId), buildPlayback(`song-${entryId}.sid`));
    }

    expect(getCachedArchivePlayback(buildReference(1))).toBeNull();
    expect(getCachedArchivePlayback(buildReference(101))).toEqual(
      expect.objectContaining({
        path: "song-101.sid",
      }),
    );
  });
});
