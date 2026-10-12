import { deferSleepTimerToTuneEnd } from "@/pages/playFiles/playbackGuards";

import { describe, expect, it, vi } from "vitest";
import {
  planPlaylistItemRemoval,
  resolveAutoAdvanceDueAtMsOnDurationChange,
  runClaimedLaunch,
} from "@/pages/playFiles/playbackGuards";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { addLog } from "@/lib/logging";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

describe("playbackGuards resolveAutoAdvanceDueAtMsOnDurationChange", () => {
  it("keeps a crossfade lead when the duration changes mid-track", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 60_000,
        trackStartedAtMs: 1_000,
        currentDueAtMs: 1_000 + 60_000,
        leadMs: 2_250,
      }),
    ).toBe(1_000 + 60_000 - 2_250);
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 60_000,
        trackStartedAtMs: 1_000,
        currentDueAtMs: 1_000 + 60_000 - 2_250,
        leadMs: 2_250,
      }),
    ).toBeNull();
  });

  it("recomputes dueAtMs from the new duration while playing", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 600_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_180_000,
      }),
    ).toBe(1_600_000);
  });

  it("shortening duration below elapsed time still yields the new (past) due time", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 60_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_600_000,
      }),
    ).toBe(1_060_000);
  });

  it("returns null when nothing is playing", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: false,
        isPaused: false,
        durationMs: 600_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: undefined,
      }),
    ).toBeNull();
  });

  it("returns null while paused, deferring to handlePauseResume's own recompute on resume", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: true,
        durationMs: 600_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_180_000,
      }),
    ).toBeNull();
  });

  it("returns null when duration is not yet resolved", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: undefined,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: undefined,
      }),
    ).toBeNull();
  });

  it("returns null when the track has not recorded a start time", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 600_000,
        trackStartedAtMs: null,
        currentDueAtMs: undefined,
      }),
    ).toBeNull();
  });

  it("returns null (no-op) when the recomputed due time already matches the guard, e.g. right after track launch", () => {
    expect(
      resolveAutoAdvanceDueAtMsOnDurationChange({
        isPlaying: true,
        isPaused: false,
        durationMs: 180_000,
        trackStartedAtMs: 1_000_000,
        currentDueAtMs: 1_180_000,
      }),
    ).toBeNull();
  });
});

describe("playbackGuards planPlaylistItemRemoval", () => {
  const item = (id: string): PlaylistItem => ({
    id,
    request: { source: "ultimate", path: `/${id}.sid` },
    category: "sid",
    label: id,
    path: `/${id}.sid`,
  });

  it("does not stop the device when removing items that are not the playing item", () => {
    const playlist = [item("a"), item("b"), item("c")];
    const plan = planPlaylistItemRemoval(playlist, 1, new Set(["c"]), true, false);

    expect(plan.shouldStopDevice).toBe(false);
    expect(plan.next.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(plan.nextCurrentIndex).toBe(1);
  });

  it("stops the device when removing the currently-playing item", () => {
    const playlist = [item("a"), item("b"), item("c")];
    const plan = planPlaylistItemRemoval(playlist, 1, new Set(["b"]), true, false);

    expect(plan.shouldStopDevice).toBe(true);
    expect(plan.next.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(plan.nextCurrentIndex).toBe(-1);
  });

  it("stops the device when removing the currently-paused item", () => {
    const playlist = [item("a"), item("b")];
    const plan = planPlaylistItemRemoval(playlist, 0, new Set(["a"]), false, true);

    expect(plan.shouldStopDevice).toBe(true);
  });

  it("does not stop the device when removing the current item while stopped", () => {
    const playlist = [item("a"), item("b")];
    const plan = planPlaylistItemRemoval(playlist, 0, new Set(["a"]), false, false);

    expect(plan.shouldStopDevice).toBe(false);
    expect(plan.nextCurrentIndex).toBe(-1);
  });

  it("recomputes the current index to follow the playing item after earlier items are removed", () => {
    const playlist = [item("a"), item("b"), item("c")];
    const plan = planPlaylistItemRemoval(playlist, 2, new Set(["a"]), true, false);

    expect(plan.shouldStopDevice).toBe(false);
    expect(plan.next.map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(plan.nextCurrentIndex).toBe(1);
  });

  it("leaves a negative current index untouched when nothing is selected/loaded", () => {
    const playlist = [item("a"), item("b")];
    const plan = planPlaylistItemRemoval(playlist, -1, new Set(["a"]), false, false);

    expect(plan.shouldStopDevice).toBe(false);
    expect(plan.nextCurrentIndex).toBe(-1);
  });

  it("clearing the whole playlist while playing stops the device and resets the index", () => {
    const playlist = [item("a"), item("b")];
    const plan = planPlaylistItemRemoval(playlist, 0, new Set(["a", "b"]), true, false);

    expect(plan.shouldStopDevice).toBe(true);
    expect(plan.next).toEqual([]);
    expect(plan.nextCurrentIndex).toBe(-1);
  });
});

describe("playbackGuards runClaimedLaunch", () => {
  it("shows the launch as loading while it runs and releases the claim when it fails", async () => {
    const ref = { current: false };
    const setLoading = vi.fn();
    let finish!: (error: Error) => void;
    const running = runClaimedLaunch(ref, setLoading, () => new Promise((_, reject) => (finish = reject)));

    expect(ref.current).toBe(true);
    expect(setLoading).toHaveBeenLastCalledWith(true);
    finish(new Error("launch failed"));
    await expect(running).rejects.toThrow("launch failed");
    expect(ref.current).toBe(false);
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it("drops a launch while another start holds the claim", async () => {
    const launch = vi.fn(async () => undefined);
    await runClaimedLaunch({ current: true }, vi.fn(), launch);
    expect(launch).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith("info", expect.stringContaining("another start is still in progress"));
  });
});

describe("sleep timer tune-end deferral", () => {
  it("moves the early crossfade deadline to the real tune end exactly once", () => {
    const guard = { dueAtMs: 116_000, deferredToEnd: false };
    expect(deferSleepTimerToTuneEnd(guard, { kind: "after-tune" }, 116_000, 0, 120_000)).toBe(120_000);
    expect(guard).toEqual({ dueAtMs: 120_000, deferredToEnd: true });
    expect(deferSleepTimerToTuneEnd(guard, { kind: "after-tune" }, 119_000, 1_000, 120_000)).toBeNull();
    expect(guard.dueAtMs).toBe(120_000);
    guard.deferredToEnd = false;
    expect(deferSleepTimerToTuneEnd(guard, { kind: "after-tune" }, 119_000, 1_000, 120_000)).toBe(121_000);
  });

  it("does not defer at the real end or without a known duration and armed guard", () => {
    const guard = { dueAtMs: 120_000 };
    expect(deferSleepTimerToTuneEnd(guard, { kind: "after-tune" }, 120_000, 0, 120_000)).toBeNull();
    expect(deferSleepTimerToTuneEnd(guard, { kind: "after-tune" }, 116_000, 0, undefined)).toBeNull();
    expect(deferSleepTimerToTuneEnd(null, { kind: "after-tune" }, 116_000, 0, 120_000)).toBeNull();
    expect(guard).toEqual({ dueAtMs: 120_000 });
  });

  it("leaves ordinary auto-advance and timed sleep deadlines unchanged", () => {
    for (const mode of [{ kind: "off" } as const, { kind: "timed", endsAtMs: 118_000, minutes: 15 } as const]) {
      const guard = { dueAtMs: 116_000 };
      expect(deferSleepTimerToTuneEnd(guard, mode, 116_000, 0, 120_000)).toBeNull();
      expect(guard).toEqual({ dueAtMs: 116_000 });
    }
  });

  it("defers once from now when the track start has not been anchored", () => {
    const guard = { dueAtMs: 116_000 };
    expect(deferSleepTimerToTuneEnd(guard, { kind: "after-tune" }, 116_000, null, 4_000)).toBe(120_000);
  });
});
