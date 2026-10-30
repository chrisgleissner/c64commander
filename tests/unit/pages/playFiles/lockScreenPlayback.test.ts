/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  formatTuneAlbum,
  isPlaybackPositionJump,
  PLAYBACK_JUMP_TOLERANCE_MS,
  positionMsToFraction,
} from "@/pages/playFiles/lockScreenPlayback";

describe("formatTuneAlbum (QW-LS-04)", () => {
  it("names the tune of a file that holds several", () => {
    expect(formatTuneAlbum(3, 19)).toBe("Tune 3 of 19");
  });

  it.each([
    [1, 1],
    [1, 0],
    [1, null],
    [null, 19],
    [0, 19],
    [20, 19],
  ])("names nothing for tune %s of %s", (tuneNumber, tuneCount) => {
    expect(formatTuneAlbum(tuneNumber, tuneCount)).toBeNull();
  });
});

describe("positionMsToFraction (QW-LS-03)", () => {
  it("divides the requested position by the tune length", () => {
    expect(positionMsToFraction(45_000, 180_000)).toBe(0.25);
  });

  it("keeps a position past either end inside the tune", () => {
    expect(positionMsToFraction(-5, 180_000)).toBe(0);
    expect(positionMsToFraction(200_000, 180_000)).toBe(1);
  });

  it.each([undefined, 0, -1, Number.NaN])("has no fraction when the length is %s", (durationMs) => {
    expect(positionMsToFraction(1_000, durationMs)).toBeNull();
  });

  it("has no fraction for a position that is not a number", () => {
    expect(positionMsToFraction(Number.NaN, 180_000)).toBeNull();
  });
});

describe("isPlaybackPositionJump (QW-LS-02)", () => {
  const last = { elapsedMs: 10_000, atMs: 1_000_000 };

  it("is not a jump while the clock keeps pace with the wall clock", () => {
    expect(isPlaybackPositionJump({ last, elapsedMs: 13_000, nowMs: 1_003_000, playing: true })).toBe(false);
  });

  it("allows the drift a busy tick produces", () => {
    const late = 3_000 + PLAYBACK_JUMP_TOLERANCE_MS;
    expect(isPlaybackPositionJump({ last, elapsedMs: 10_000 + late, nowMs: 1_003_000, playing: true })).toBe(false);
  });

  it("is a jump forward past the tolerance", () => {
    expect(isPlaybackPositionJump({ last, elapsedMs: 70_000, nowMs: 1_001_000, playing: true })).toBe(true);
  });

  it("is a jump back past the tolerance", () => {
    expect(isPlaybackPositionJump({ last, elapsedMs: 2_000, nowMs: 1_001_000, playing: true })).toBe(true);
  });

  it("expects a paused clock to stand still", () => {
    expect(isPlaybackPositionJump({ last, elapsedMs: 10_000, nowMs: 1_060_000, playing: false })).toBe(false);
    expect(isPlaybackPositionJump({ last, elapsedMs: 40_000, nowMs: 1_060_000, playing: false })).toBe(true);
  });

  it("is not a jump when nothing has been observed yet", () => {
    expect(isPlaybackPositionJump({ last: null, elapsedMs: 40_000, nowMs: 1_000_000, playing: true })).toBe(false);
  });
});
