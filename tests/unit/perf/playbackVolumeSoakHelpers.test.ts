import { describe, expect, it } from "vitest";
import {
  computeCircularAdvanceDelta,
  computeCircularRetreatDelta,
  computeCircularStepDistance,
  hasPlaylistSelectionChanged,
  isActionableSoakTraceError,
  resolvePlaylistIndexFromState,
} from "@/lib/perf/playbackVolumeSoakHelpers";

describe("playbackVolumeSoakHelpers", () => {
  it("treats wraparound next as a single-step advance", () => {
    expect(computeCircularAdvanceDelta(9, 0, 10)).toBe(1);
  });

  it("treats wraparound previous as a single-step retreat", () => {
    expect(computeCircularRetreatDelta(0, 9, 10)).toBe(1);
  });

  it("falls back to direct deltas when playlist count is unavailable", () => {
    expect(computeCircularAdvanceDelta(2, 3, 0)).toBe(1);
    expect(computeCircularRetreatDelta(3, 2, 0)).toBe(1);
  });

  it("treats wraparound adjacency as a single circular step", () => {
    expect(computeCircularStepDistance(0, 19, 20)).toBe(1);
    expect(computeCircularStepDistance(19, 0, 20)).toBe(1);
  });

  it("prefers the playback-session index over rendered playlist order", () => {
    expect(
      resolvePlaylistIndexFromState({
        playlistItemIds: ["track-15", "track-16", "track-17"],
        playbackSession: { currentItemId: "track-15", currentIndex: 14 },
      }),
    ).toBe(14);
  });

  it("derives the active playlist index from the current item id when the session index is unavailable", () => {
    expect(
      resolvePlaylistIndexFromState({
        playlistItemIds: ["a", "b", "c"],
        playbackSession: { currentItemId: "b", currentIndex: null },
      }),
    ).toBe(1);
  });

  it("detects playlist selection changes from item identity", () => {
    expect(
      hasPlaylistSelectionChanged(
        {
          playlistItemIds: ["a", "b", "c"],
          playbackSession: { currentItemId: "a", currentIndex: 0 },
          currentTrack: "Track A",
        },
        {
          playlistItemIds: ["a", "b", "c"],
          playbackSession: { currentItemId: "b", currentIndex: 0 },
          currentTrack: "Track B",
        },
      ),
    ).toBe(true);
  });

  it("ignores system-origin and cancellation trace errors for soak verdicts", () => {
    expect(
      isActionableSoakTraceError({
        type: "error",
        origin: "system",
        data: { message: "Host unreachable", expectedFailure: false },
      }),
    ).toBe(false);
    expect(
      isActionableSoakTraceError({
        type: "error",
        origin: "user",
        data: { message: "The operation was aborted", expectedFailure: false },
      }),
    ).toBe(false);
    expect(
      isActionableSoakTraceError({
        type: "error",
        origin: "user",
        data: { message: "Firmware rejected request", expectedFailure: false },
      }),
    ).toBe(true);
  });
});
