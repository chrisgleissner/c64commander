/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  isChosenTrackLaunching,
  resolveShownItemDurationMs,
  type ShownDurationState,
} from "@/pages/playFiles/shownTrackDuration";
import type { PlaylistItem } from "@/pages/playFiles/types";

const item = (id: string, durationMs?: number) => ({ id, durationMs }) as PlaylistItem;

const launched = item("launched", 236_000);
const timedChoice = item("timed", 350_000);
const untimedChoice = item("untimed");

const state = (overrides: Partial<ShownDurationState> = {}): ShownDurationState => ({
  currentIndex: 1,
  durationMs: 236_000,
  durationMsItemId: "launched",
  isPlaying: true,
  isPaused: false,
  fallbackMs: 180_000,
  ...overrides,
});

describe("resolveShownItemDurationMs", () => {
  it("gives an item that is not current its own length, or the default length", () => {
    expect(resolveShownItemDurationMs(timedChoice, 0, state())).toBe(350_000);
    expect(resolveShownItemDurationMs(untimedChoice, 0, state())).toBe(180_000);
  });

  it("gives the launched track the length its launch resolved", () => {
    expect(resolveShownItemDurationMs(item("launched"), 1, state())).toBe(236_000);
  });

  it("gives durationMs to the current item while nothing has recorded which item it belongs to", () => {
    expect(resolveShownItemDurationMs(timedChoice, 1, state({ durationMsItemId: null }))).toBe(236_000);
  });

  it("gives a chosen track its own length while it launches, or no length when it has none", () => {
    expect(resolveShownItemDurationMs(timedChoice, 1, state())).toBe(350_000);
    expect(resolveShownItemDurationMs(untimedChoice, 1, state())).toBeUndefined();
    expect(resolveShownItemDurationMs(untimedChoice, 1, state({ isPlaying: false, isPaused: true }))).toBeUndefined();
  });

  it("gives a track chosen while stopped its own length, or the default length it will be launched with", () => {
    const stopped = state({ isPlaying: false });
    expect(resolveShownItemDurationMs(timedChoice, 1, stopped)).toBe(350_000);
    expect(resolveShownItemDurationMs(untimedChoice, 1, stopped)).toBe(180_000);
  });
});

describe("isChosenTrackLaunching", () => {
  it("holds only while a track plays or is paused and the current item is not the one it launched", () => {
    expect(isChosenTrackLaunching(timedChoice, state())).toBe(true);
    expect(isChosenTrackLaunching(timedChoice, state({ isPlaying: false, isPaused: true }))).toBe(true);
    expect(isChosenTrackLaunching(launched, state())).toBe(false);
    expect(isChosenTrackLaunching(timedChoice, state({ isPlaying: false }))).toBe(false);
    expect(isChosenTrackLaunching(timedChoice, state({ durationMsItemId: null }))).toBe(false);
    expect(isChosenTrackLaunching(undefined, state())).toBe(false);
  });
});
