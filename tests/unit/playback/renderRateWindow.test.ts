import { describe, expect, it } from "vitest";

import { RenderRateWindow } from "@/lib/playback/renderRateWindow";

describe("RenderRateWindow", () => {
  it("reports 0 before the first rate", () => {
    expect(new RenderRateWindow(8).p99()).toBe(0);
  });

  it("returns the 99th percentile of the recorded rates", () => {
    const window = new RenderRateWindow(200);
    for (let rate = 1; rate <= 100; rate += 1) window.record(rate);
    expect(window.p99()).toBe(99);
  });

  it("keeps only the most recent rates once its capacity is reached", () => {
    const window = new RenderRateWindow(4);
    [900, 800, 1, 2, 3, 4].forEach((rate) => window.record(rate));
    expect(window.p99()).toBe(4);
  });

  it("recomputes after a new rate and not before", () => {
    const window = new RenderRateWindow(8);
    window.record(10);
    expect(window.p99()).toBe(10);
    window.record(50);
    expect(window.p99()).toBe(50);
  });

  it("forgets everything when cleared", () => {
    const window = new RenderRateWindow(8);
    window.record(10);
    window.clear();
    expect(window.p99()).toBe(0);
    window.record(3);
    expect(window.p99()).toBe(3);
  });
});
