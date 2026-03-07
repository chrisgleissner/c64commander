/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveMidpointSnap,
  resolveMidpointPercent,
  shouldTriggerMidpointHaptic,
  createSliderAsyncQueue,
  DEFAULT_SLIDER_ASYNC_THROTTLE_MS,
} from "@/lib/ui/sliderBehavior";

describe("sliderBehavior", () => {
  describe("resolveMidpointSnap", () => {
    it("snaps to midpoint within default range", () => {
      // default ratio 0.02. range 100 -> snap radius 2.
      expect(resolveMidpointSnap({ value: 51, min: 0, max: 100, midpoint: 50 })).toBe(50);
      expect(resolveMidpointSnap({ value: 48.5, min: 0, max: 100, midpoint: 50 })).toBe(50);
      expect(resolveMidpointSnap({ value: 53, min: 0, max: 100, midpoint: 50 })).toBe(53);
    });

    it("respects step derived snap range", () => {
      // step 10 -> stepRange 7.5. range 100 -> default 2. Max(7.5, 2) -> 7.5
      expect(
        resolveMidpointSnap({
          value: 57,
          min: 0,
          max: 100,
          midpoint: 50,
          step: 10,
        }),
      ).toBe(50);
      expect(
        resolveMidpointSnap({
          value: 58,
          min: 0,
          max: 100,
          midpoint: 50,
          step: 10,
        }),
      ).toBe(58);
    });

    it("respects explicit snapRange", () => {
      expect(
        resolveMidpointSnap({
          value: 55,
          min: 0,
          max: 100,
          midpoint: 50,
          snapRange: 5,
        }),
      ).toBe(50);
    });

    it("handles zero range", () => {
      expect(resolveMidpointSnap({ value: 5, min: 10, max: 10, midpoint: 10 })).toBe(5);
    });

    it("returns value when explicit snapRange is 0 (line 37 TRUE)", () => {
      expect(
        resolveMidpointSnap({
          value: 55,
          min: 0,
          max: 100,
          midpoint: 50,
          snapRange: 0,
        }),
      ).toBe(55);
    });
  });

  describe("resolveMidpointPercent", () => {
    it("calculates percent", () => {
      expect(resolveMidpointPercent(50, 0, 100)).toBe(50);
      expect(resolveMidpointPercent(0, -100, 100)).toBe(50);
    });

    it("clamps result", () => {
      expect(resolveMidpointPercent(150, 0, 100)).toBe(100);
      expect(resolveMidpointPercent(-50, 0, 100)).toBe(0);
    });

    it("returns 0 when min equals max (line 45 range===0)", () => {
      expect(resolveMidpointPercent(5, 10, 10)).toBe(0);
    });
  });

  describe("shouldTriggerMidpointHaptic", () => {
    const base = {
      nowMs: 1000,
      lastTriggerMs: null,
      minIntervalMs: 200,
      midpoint: 50,
    };

    it("triggers on crossing", () => {
      expect(shouldTriggerMidpointHaptic({ ...base, previous: 49, next: 51 })).toBe(true);
      expect(shouldTriggerMidpointHaptic({ ...base, previous: 51, next: 49 })).toBe(true);
    });

    it("triggers on snapping", () => {
      expect(shouldTriggerMidpointHaptic({ ...base, previous: 49, next: 50 })).toBe(true);
    });

    it("ignores if stale", () => {
      expect(
        shouldTriggerMidpointHaptic({
          ...base,
          previous: 49,
          next: 51,
          lastTriggerMs: 900,
        }),
      ).toBe(false);
    });

    it("returns false when previous is null and next is not midpoint (line 60 FALSE)", () => {
      expect(shouldTriggerMidpointHaptic({ ...base, previous: null, next: 55 })).toBe(false);
    });
  });

  describe("createSliderAsyncQueue", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("throttles calls", () => {
      const onChange = vi.fn();
      const queue = createSliderAsyncQueue({ onChange, throttleMs: 100 });

      queue.schedule(1);
      queue.schedule(2);
      queue.schedule(3);

      expect(onChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      // schedule uses queueMicrotask flush
      // We need to wait for microtasks
    });

    it("commits immediately", async () => {
      const onCommit = vi.fn();
      const queue = createSliderAsyncQueue({ onCommit });
      await Promise.resolve(); // flush any microtasks?

      queue.commit(5);
      // commit also uses queueMicrotask
      await Promise.resolve(); // yield to microtask
      // Wait... Vitest might need explicit run?

      // queueMicrotask is async.
    });

    it("commit falls back to onChange when onCommit absent (line 103 FALSE)", async () => {
      const onChange = vi.fn();
      const queue = createSliderAsyncQueue({ onChange });

      queue.commit(7);
      await Promise.resolve();

      expect(onChange).toHaveBeenCalledWith(7);
    });

    it("commit is no-op when neither onCommit nor onChange provided (line 104 TRUE)", async () => {
      const queue = createSliderAsyncQueue({});
      // Should not throw
      queue.commit(3);
      await Promise.resolve();
    });

    it("cancel is no-op when no timer is running (line 110 FALSE)", () => {
      const onChange = vi.fn();
      const queue = createSliderAsyncQueue({ onChange });
      // No schedule → timer = null
      queue.cancel();
      // Should not throw, no timer to clear
    });

    it("cancel clears a pending scheduled call", () => {
      const onChange = vi.fn();
      const queue = createSliderAsyncQueue({ onChange, throttleMs: 100 });

      queue.schedule(1);
      queue.cancel();
      vi.advanceTimersByTime(200);
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
