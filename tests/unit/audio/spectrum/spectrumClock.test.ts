import { describe, expect, it } from "vitest";
import { NativeClockOffset } from "@/lib/audio/spectrum/spectrumClock";

describe("native clock offset", () => {
  it("knows nothing until a reply with a native time arrives", () => {
    const clock = new NativeClockOffset();
    expect(clock.known).toBe(false);
    expect(clock.nativeNanosAt(100)).toBe(0);
    clock.add(10, 20, 0);
    expect(clock.known).toBe(false);
  });

  it("maps a page time to the native clock using the middle of the round trip", () => {
    const clock = new NativeClockOffset();
    clock.add(100, 110, 5_000_000_000 + 105 * 1e6);
    expect(clock.known).toBe(true);
    expect(clock.nativeNanosAt(200)).toBe(5_000_000_000 + 200 * 1e6);
  });

  it("trusts the reply with the shortest round trip over a slow one with a different offset", () => {
    const clock = new NativeClockOffset();
    clock.add(0, 4, 1_000_000_000 + 2 * 1e6);
    clock.add(100, 140, 1_000_000_000 + 190 * 1e6);
    expect(clock.nativeNanosAt(50)).toBe(1_000_000_000 + 50 * 1e6);
  });

  it("ignores a reply that arrives before it was sent", () => {
    const clock = new NativeClockOffset();
    clock.add(50, 40, 1e9);
    expect(clock.known).toBe(false);
  });

  it("forgets a good sample once enough newer replies have pushed it out", () => {
    const clock = new NativeClockOffset();
    clock.add(0, 1, 1e9 + 0.5e6);
    for (let i = 0; i < 32; i++) clock.add(10 + i * 10, 15 + i * 10, 2e9 + (12.5 + i * 10) * 1e6);
    expect(clock.nativeNanosAt(100)).toBe(Math.round(2e9 + 100 * 1e6));
  });
});
