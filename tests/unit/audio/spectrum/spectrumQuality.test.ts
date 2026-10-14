/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  SPECTRUM_PROMOTE_BACKOFF_LIMIT_MS,
  SPECTRUM_PROMOTE_EVERY_MS,
  SPECTRUM_TIERS,
  createSpectrumTierController,
  initialSpectrumTier,
} from "@/lib/audio/spectrum/spectrumQuality";

const feed = (
  controller: ReturnType<typeof createSpectrumTierController>,
  fromMs: number,
  toMs: number,
  costMs: number,
  intervalMs: number,
) => {
  let changed = null;
  for (let t = fromMs; t <= toMs; t += intervalMs) {
    changed = controller.report(t, costMs, intervalMs) ?? changed;
  }
  return changed;
};

describe("spectrum quality tiers", () => {
  it("describes the four tiers of the contract", () => {
    expect(SPECTRUM_TIERS.map((t) => [t.drawFps, t.bars, t.glow, t.gradient])).toEqual([
      [60, 48, true, true],
      [30, 48, false, true],
      [20, 24, false, true],
      [12, 12, false, false],
    ]);
  });

  it("starts at tier 1 on the compact profile and on weak devices, otherwise at tier 0", () => {
    expect(initialSpectrumTier({ profile: "compact" }).index).toBe(1);
    expect(initialSpectrumTier({ profile: "medium", hardwareConcurrency: 4 }).index).toBe(1);
    expect(initialSpectrumTier({ profile: "medium", deviceMemory: 2 }).index).toBe(1);
    expect(initialSpectrumTier({ profile: "medium", hardwareConcurrency: 8, deviceMemory: 8 }).index).toBe(0);
    expect(initialSpectrumTier({ profile: "expanded" }).index).toBe(0);
  });

  it("drops a tier after one second of frames over budget, and not before", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[0], 0);
    expect(feed(controller, 16, 950, 12, 16.7)).toBeNull();
    expect(controller.tier.index).toBe(0);
    const changed = feed(controller, 960, 1100, 12, 16.7);
    expect(changed?.index).toBe(1);
  });

  it("counts a frame that arrives late as over budget even when drawing was cheap", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[1], 0);
    expect(feed(controller, 40, 1200, 1, 80)?.index).toBe(2);
  });

  it("keeps the tier while most frames meet their budget", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[0], 0);
    let heavy = false;
    for (let t = 16; t < 3000; t += 16.7) {
      heavy = !heavy;
      controller.report(t, 2, 16.7);
    }
    expect(controller.tier.index).toBe(0);
  });

  it("never drops below the lowest tier", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[3], 0);
    expect(feed(controller, 100, 5000, 200, 100)).toBeNull();
    expect(controller.tier.index).toBe(3);
  });

  it("promotes only after the minimum interval, only with headroom, and never above its starting tier", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[1], 0);
    feed(controller, 40, 1200, 40, 40);
    expect(controller.tier.index).toBe(2);
    const changedAt = 1200;
    expect(feed(controller, changedAt + 50, changedAt + SPECTRUM_PROMOTE_EVERY_MS - 1500, 1, 33)).toBeNull();
    expect(
      feed(
        controller,
        changedAt + SPECTRUM_PROMOTE_EVERY_MS - 1400,
        changedAt + SPECTRUM_PROMOTE_EVERY_MS + 1500,
        1,
        33,
      )?.index,
    ).toBe(1);
    expect(feed(controller, changedAt + 20000, changedAt + 60000, 1, 33)).toBeNull();
    expect(controller.tier.index).toBe(1);
  });

  it("does not promote while the draw still uses much of the faster tier's frame", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[0], 0);
    feed(controller, 16, 1200, 20, 16.7);
    expect(controller.tier.index).toBe(1);
    expect(feed(controller, 1300, 30000, 12, 33)).toBeNull();
    expect(controller.tier.index).toBe(1);
  });

  it("backs the promotion interval off after a promotion that had to be undone", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[0], 0);
    let now = 0;
    const demote = () => {
      const changed = feed(controller, now + 16.7, now + 1100, 20, 16.7);
      now += 1100;
      return changed;
    };
    const quietUntilPromoted = (limitMs: number) => {
      const started = now;
      while (now - started < limitMs && controller.tier.index !== 0) {
        now += 33;
        controller.report(now, 1, 33);
      }
      return now - started;
    };
    expect(demote()?.index).toBe(1);
    const firstWait = quietUntilPromoted(40_000);
    expect(controller.tier.index).toBe(0);
    expect(demote()?.index).toBe(1);
    const secondWait = quietUntilPromoted(80_000);
    expect(controller.tier.index).toBe(0);
    expect(secondWait).toBeGreaterThanOrEqual(2 * SPECTRUM_PROMOTE_EVERY_MS);
    expect(firstWait).toBeLessThan(2 * SPECTRUM_PROMOTE_EVERY_MS);
    expect(SPECTRUM_PROMOTE_BACKOFF_LIMIT_MS).toBeGreaterThan(SPECTRUM_PROMOTE_EVERY_MS);
  });

  it("forgets the window when restarted", () => {
    const controller = createSpectrumTierController(SPECTRUM_TIERS[0], 0);
    feed(controller, 16, 900, 12, 16.7);
    controller.restart(10_000);
    expect(feed(controller, 10_016, 10_900, 12, 16.7)).toBeNull();
  });
});
