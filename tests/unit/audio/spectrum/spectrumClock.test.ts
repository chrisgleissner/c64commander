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

  it("is not moved by a stretch of slow replies with a different offset", () => {
    const clock = new NativeClockOffset();
    for (let i = 0; i < 20; i++) clock.add(i * 10, i * 10 + 4, 1e9 + (i * 10 + 2) * 1e6);
    for (let i = 0; i < 40; i++) clock.add(300 + i * 10, 300 + i * 10 + 40, 1e9 + (300 + i * 10 + 35) * 1e6);
    expect(clock.nativeNanosAt(500)).toBe(Math.round((500 + 1e9 / 1e6) * 1e6));
  });

  it("averages the offsets of the fastest replies rather than trusting one", () => {
    const clock = new NativeClockOffset();
    for (let i = 0; i < 8; i++) {
      const wrongBy = i % 2 === 0 ? 1.5 : -1.5;
      clock.add(i * 10, i * 10 + 6, 1e9 + (i * 10 + 3 + wrongBy) * 1e6);
    }
    expect(clock.nativeNanosAt(50)).toBe(Math.round((50 + 1000) * 1e6));
  });

  it("ignores a reply that arrives before it was sent", () => {
    const clock = new NativeClockOffset();
    clock.add(50, 40, 1e9);
    expect(clock.known).toBe(false);
  });

  it("forgets old replies once enough newer ones have pushed them out", () => {
    const clock = new NativeClockOffset();
    for (let i = 0; i < 8; i++) clock.add(i * 10, i * 10 + 1, 1e9 + (i * 10 + 0.5) * 1e6);
    for (let i = 0; i < 256; i++) clock.add(100 + i * 10, 105 + i * 10, 2e9 + (102.5 + i * 10) * 1e6);
    expect(clock.nativeNanosAt(100)).toBe(Math.round(2e9 + 100 * 1e6));
  });
});
