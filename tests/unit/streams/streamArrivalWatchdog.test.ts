/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StreamArrivalWatchdog } from "@/lib/streams/streamArrivalWatchdog";

/**
 * A live mirror that stops receiving.
 *
 * A bound multicast socket reports neither an error nor a close when the packets simply stop, so
 * nothing else in the mirror pipeline can notice. Everything here turns on that: silence must be
 * reported, an arrival must reset it, and a timer that was not running must not be mistaken for it.
 */

describe("StreamArrivalWatchdog", () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const makeWatchdog = (onStale: (ms: number) => void, pollArrival?: () => boolean) =>
    new StreamArrivalWatchdog({ onStale, pollArrival, now, timeoutMs: 8000, checkIntervalMs: 1000 });

  /** Advance both the injected clock and the timers together, one check interval at a time. */
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      clock += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  it("reports silence once the timeout passes with nothing arriving", async () => {
    const onStale = vi.fn();
    makeWatchdog(onStale).start();

    await advance(7000);
    expect(onStale).not.toHaveBeenCalled();

    await advance(2000);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale.mock.calls[0][0]).toBeGreaterThanOrEqual(8000);
  });

  it("reports it once, not on every check afterwards", async () => {
    const onStale = vi.fn();
    makeWatchdog(onStale).start();
    await advance(30_000);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while packets keep arriving", async () => {
    const onStale = vi.fn();
    const watchdog = makeWatchdog(onStale);
    watchdog.start();
    for (let i = 0; i < 30; i += 1) {
      await advance(1000);
      watchdog.noteArrival();
    }
    expect(onStale).not.toHaveBeenCalled();
  });

  it("counts a polled arrival source, for a path whose packets never reach JS", async () => {
    const onStale = vi.fn();
    let arriving = true;
    makeWatchdog(onStale, () => arriving).start();

    await advance(20_000);
    expect(onStale).not.toHaveBeenCalled();

    arriving = false;
    await advance(9000);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("does not call a starved timer silence", async () => {
    // A hidden WebView suspends setInterval almost entirely. On return the wall clock has moved far
    // past the timeout, but nothing was observed in that gap — reporting it would turn every
    // background/foreground cycle into a false "stream lost".
    const onStale = vi.fn();
    makeWatchdog(onStale).start();

    clock += 120_000; // the app was in the background; the timer did not run
    await vi.advanceTimersByTimeAsync(1000); // the first check after coming back

    expect(onStale).not.toHaveBeenCalled();

    // and it starts measuring again from that moment rather than from before the gap
    await advance(9000);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("stops reporting once disarmed", async () => {
    const onStale = vi.fn();
    const watchdog = makeWatchdog(onStale);
    watchdog.start();
    expect(watchdog.running).toBe(true);
    watchdog.stop();
    expect(watchdog.running).toBe(false);
    await advance(30_000);
    expect(onStale).not.toHaveBeenCalled();
  });
});
