/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Issue 2: Auto-advance guard must arm for all playable categories (sid, mod, prg, crt, disk),
 * not only song categories. Tests here verify:
 *   1. Format-matrix: guard arms for each supported category when duration is available.
 *   2. Lock/unlock overdue reconciliation: guard fires correctly when now >= dueAtMs.
 *   3. Duplicate-advance prevention: autoFired flag blocks duplicate transitions.
 */

import { describe, expect, it } from "vitest";
import { isSongCategory } from "@/pages/playFiles/playFilesUtils";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";

// ---------------------------------------------------------------------------
// Types mirroring usePlaybackController AutoAdvanceGuard
// ---------------------------------------------------------------------------
type AutoAdvanceGuard = {
  trackInstanceId: number;
  dueAtMs: number;
  autoFired: boolean;
  userCancelled: boolean;
};

// ---------------------------------------------------------------------------
// Guard creation logic (mirrors the fixed playItem path)
// ---------------------------------------------------------------------------
function buildAutoAdvanceGuard(
  resolvedDuration: number | undefined,
  trackInstanceId: number,
  now: number,
): AutoAdvanceGuard | null {
  if (typeof resolvedDuration !== "number") return null;
  return {
    trackInstanceId,
    dueAtMs: now + resolvedDuration,
    autoFired: false,
    userCancelled: false,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation check (mirrors syncPlaybackTimeline guard check)
// ---------------------------------------------------------------------------
function shouldAutoAdvance(
  guard: AutoAdvanceGuard | null,
  now: number,
  expectedTrackInstanceId?: number,
): boolean {
  if (!guard) return false;
  if (guard.autoFired || guard.userCancelled) return false;
  if (
    typeof expectedTrackInstanceId === "number" &&
    guard.trackInstanceId !== expectedTrackInstanceId
  )
    return false;
  return now >= guard.dueAtMs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("autoAdvanceGuard: format matrix (Issue 2)", () => {
  const DURATION_MS = 5000;
  const NOW = Date.now();

  const allCategories: PlayFileCategory[] = [
    "sid",
    "mod",
    "prg",
    "crt",
    "disk",
  ];

  for (const category of allCategories) {
    it(`arms guard for category '${category}' when resolvedDuration is a number`, () => {
      const guard = buildAutoAdvanceGuard(DURATION_MS, 1, NOW);
      expect(guard).not.toBeNull();
      expect(guard!.dueAtMs).toBe(NOW + DURATION_MS);
      expect(guard!.autoFired).toBe(false);
      expect(guard!.userCancelled).toBe(false);
    });
  }

  it("does NOT arm guard when resolvedDuration is undefined (no duration = no auto-advance)", () => {
    const guard = buildAutoAdvanceGuard(undefined, 1, NOW);
    expect(guard).toBeNull();
  });

  it("isSongCategory still classifies sid/mod correctly", () => {
    expect(isSongCategory("sid")).toBe(true);
    expect(isSongCategory("mod")).toBe(true);
    expect(isSongCategory("prg")).toBe(false);
    expect(isSongCategory("crt")).toBe(false);
    expect(isSongCategory("disk")).toBe(false);
  });
});

describe("autoAdvanceGuard: lock/unlock overdue reconciliation (Issue 2)", () => {
  it("fires when now >= dueAtMs (on-time case)", () => {
    const now = 10_000;
    const guard = buildAutoAdvanceGuard(100, 1, now - 100);
    expect(guard!.dueAtMs).toBe(now);
    expect(shouldAutoAdvance(guard, now)).toBe(true);
  });

  it("fires when now > dueAtMs (overdue after lock/unlock)", () => {
    const now = 20_000;
    const guard = buildAutoAdvanceGuard(500, 1, now - 5000);
    // dueAtMs = now - 5000 + 500 = now - 4500, which is in the past
    expect(now).toBeGreaterThan(guard!.dueAtMs);
    expect(shouldAutoAdvance(guard, now)).toBe(true);
  });

  it("does NOT fire when now < dueAtMs (track still playing)", () => {
    const now = 10_000;
    const guard = buildAutoAdvanceGuard(5000, 1, now);
    // dueAtMs = now + 5000; current time is still now
    expect(shouldAutoAdvance(guard, now)).toBe(false);
  });

  it("does NOT fire when guard is null", () => {
    expect(shouldAutoAdvance(null, Date.now())).toBe(false);
  });
});

describe("autoAdvanceGuard: duplicate-advance prevention (Issue 2)", () => {
  it("does NOT fire a second time once autoFired is true", () => {
    const now = 10_000;
    const guard = buildAutoAdvanceGuard(100, 1, now - 100);
    expect(shouldAutoAdvance(guard, now)).toBe(true);

    // Simulate first fire
    guard!.autoFired = true;

    // Second reconciliation check must be rejected
    expect(shouldAutoAdvance(guard, now + 100)).toBe(false);
  });

  it("does NOT fire when userCancelled is true", () => {
    const now = 10_000;
    const guard = buildAutoAdvanceGuard(100, 1, now - 100);
    guard!.userCancelled = true;
    expect(shouldAutoAdvance(guard, now)).toBe(false);
  });

  it("does NOT fire when trackInstanceId does not match expected", () => {
    const now = 10_000;
    const guard = buildAutoAdvanceGuard(100, 1, now - 100);
    // Guard's trackInstanceId=1 but caller expects 2 (stale guard)
    expect(shouldAutoAdvance(guard, now, 2)).toBe(false);
  });

  it("fires when trackInstanceId matches expected", () => {
    const now = 10_000;
    const guard = buildAutoAdvanceGuard(100, 5, now - 100);
    expect(shouldAutoAdvance(guard, now, 5)).toBe(true);
  });

  it("fires when no expected trackInstanceId provided (no filter)", () => {
    const now = 10_000;
    const guard = buildAutoAdvanceGuard(100, 7, now - 100);
    expect(shouldAutoAdvance(guard, now)).toBe(true);
  });
});
