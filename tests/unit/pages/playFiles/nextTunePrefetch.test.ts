/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistItem } from "@/pages/playFiles/types";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import {
  NextTunePrefetcher,
  PREFETCH_BEFORE_END_MS,
  PREFETCH_MAX_BYTES,
  PREFETCH_RETRY_MS,
  PREFETCH_SETTLE_MS,
  PREFETCH_TIMEOUT_MS,
  needsPrefetch,
} from "@/pages/playFiles/nextTunePrefetch";

const item = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    label: `${id}.sid`,
    path: `/Usb0/${id}.sid`,
    category: "sid",
    request: { source: "ultimate", path: `/Usb0/${id}.sid` },
    ...overrides,
  }) as unknown as PlaylistItem;

const blob = (bytes = 100) => new Blob([new Uint8Array(bytes)]);

describe("prefetching the next tune's bytes from the Ultimate", () => {
  let ready: boolean;
  let fetchBlob: ReturnType<typeof vi.fn>;
  let onStored: ReturnType<typeof vi.fn>;
  let prefetcher: NextTunePrefetcher;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(addLog).mockClear();
    ready = true;
    fetchBlob = vi.fn(async () => blob());
    onStored = vi.fn();
    prefetcher = new NextTunePrefetcher({ fetchBlob, isDeviceReady: () => ready, onStored });
  });

  afterEach(() => {
    prefetcher.clear();
    vi.useRealTimers();
  });

  it("reads the next tune once, shortly before the current one ends, and not earlier", async () => {
    prefetcher.schedule(item("next"), 180_000);

    await vi.advanceTimersByTimeAsync(180_000 - PREFETCH_BEFORE_END_MS - 1);
    expect(fetchBlob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchBlob).toHaveBeenCalledTimes(1);
    expect(fetchBlob.mock.calls[0][0].id).toBe("next");
    expect(onStored).toHaveBeenCalledTimes(1);
    expect(prefetcher.peek("next")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchBlob).toHaveBeenCalledTimes(1);
  });

  it("reads right after the start when the current tune is shorter than the lead window", async () => {
    prefetcher.schedule(item("next"), 20_000);

    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    expect(fetchBlob).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a tune on the phone", item("a", { request: { source: "local", path: "/a.sid", file: {} } })],
    ["an HVSC tune", item("b", { request: { source: "hvsc", path: "/b.sid" } })],
    ["a tune that is not a SID", item("c", { category: "prg" })],
    ["nothing", undefined],
  ])("does not read %s", async (_name, next) => {
    expect(needsPrefetch(next)).toBe(false);
    prefetcher.schedule(next, 10_000);

    await vi.advanceTimersByTimeAsync(600_000);

    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it("cancels a pending read when the user skips", async () => {
    prefetcher.schedule(item("next"), 180_000);
    await vi.advanceTimersByTimeAsync(100_000);

    prefetcher.cancel();
    await vi.advanceTimersByTimeAsync(600_000);

    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it("aborts a read in flight and discards its bytes when cancelled", async () => {
    let signal: AbortSignal | undefined;
    fetchBlob.mockImplementation(
      (_item: PlaylistItem, s: AbortSignal) =>
        new Promise<Blob | null>((resolve) => {
          signal = s;
          s.addEventListener("abort", () => resolve(blob()));
        }),
    );
    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    prefetcher.cancel();
    await vi.advanceTimersByTimeAsync(0);

    expect(signal?.aborted).toBe(true);
    expect(prefetcher.peek("next")).toBeNull();
    expect(onStored).not.toHaveBeenCalled();
  });

  it("never has two reads in flight, even when a new tune is scheduled while one is still being abandoned", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    fetchBlob.mockImplementation(async (_item: PlaylistItem, s: AbortSignal) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000);
        s.addEventListener("abort", () => {
          clearTimeout(timer);
          setTimeout(resolve, 5000);
        });
      });
      inFlight -= 1;
      return blob();
    });
    prefetcher.schedule(item("one"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS + 100);
    expect(inFlight).toBe(1);

    prefetcher.schedule(item("two"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS + 100);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchBlob).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it("does not read while the device is busy, and tries once more after the retry delay", async () => {
    ready = false;
    prefetcher.schedule(item("next"), 10_000);

    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
    expect(fetchBlob).not.toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Next tune prefetch failed",
      expect.objectContaining({ willRetry: true }),
    );

    ready = true;
    await vi.advanceTimersByTimeAsync(PREFETCH_RETRY_MS);
    expect(fetchBlob).toHaveBeenCalledTimes(1);
    expect(prefetcher.peek("next")).not.toBeNull();
  });

  it("logs a failed read as a warning, retries once after 30 s, and then gives up", async () => {
    fetchBlob.mockResolvedValue(null);
    prefetcher.schedule(item("next"), 10_000);

    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
    expect(fetchBlob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PREFETCH_RETRY_MS);
    expect(fetchBlob).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * PREFETCH_RETRY_MS);

    expect(fetchBlob).toHaveBeenCalledTimes(2);
    expect(prefetcher.peek("next")).toBeNull();
    const warnings = vi.mocked(addLog).mock.calls.filter(([level, message]) => {
      return level === "warn" && message === "Next tune prefetch failed";
    });
    expect(warnings.map(([, , details]) => (details as { willRetry: boolean }).willRetry)).toEqual([true, false]);
  });

  it("abandons a read that takes longer than ten seconds and aborts it", async () => {
    let signal: AbortSignal | undefined;
    fetchBlob.mockImplementation((_item: PlaylistItem, s: AbortSignal) => {
      signal = s;
      return new Promise<Blob | null>(() => undefined);
    });
    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    await vi.advanceTimersByTimeAsync(PREFETCH_TIMEOUT_MS);

    expect(signal?.aborted).toBe(true);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Next tune prefetch failed",
      expect.objectContaining({ reason: expect.stringContaining("timed out") }),
    );
  });

  it("logs once when the stored bytes are handed over, and not when there are none", async () => {
    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
    vi.mocked(addLog).mockClear();

    prefetcher.take("next");
    prefetcher.take("next");

    const used = vi.mocked(addLog).mock.calls.filter(([, message]) => /stored bytes used/.test(message));
    expect(used).toHaveLength(1);
    expect(used[0][2]).toMatchObject({ id: "next" });
  });

  it("hands the bytes over once, and forgets entries that no longer belong to the next tune", async () => {
    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    expect(prefetcher.take("next")).not.toBeNull();
    expect(prefetcher.take("next")).toBeNull();

    await vi.advanceTimersByTimeAsync(0);
    prefetcher.schedule(item("other"), 600_000);
    prefetcher.schedule(item("third"), 600_000);
    expect(prefetcher.peek("other")).toBeNull();
  });

  it("evicts stored bytes when the next tune changes and when playback stops", async () => {
    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
    expect(prefetcher.peek("next")).not.toBeNull();

    prefetcher.schedule(item("different"), 600_000);
    expect(prefetcher.peek("next")).toBeNull();

    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
    prefetcher.clear();
    expect(prefetcher.peek("next")).toBeNull();
  });

  it("does not keep a file larger than the byte cap", async () => {
    fetchBlob.mockResolvedValue(blob(PREFETCH_MAX_BYTES + 1));
    prefetcher.schedule(item("big"), 10_000);

    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    expect(prefetcher.peek("big")).toBeNull();
    expect(onStored).not.toHaveBeenCalled();
  });

  it("reads right after the settle delay when the current tune has no known length", async () => {
    prefetcher.schedule(item("next"), null);

    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    expect(fetchBlob).toHaveBeenCalledTimes(1);
  });

  it("forgets stored bytes when there is no next tune any more", async () => {
    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
    expect(prefetcher.peek("next")).not.toBeNull();

    prefetcher.schedule(null, null);

    expect(prefetcher.peek("next")).toBeNull();
  });

  it.each([
    ["an Error", new Error("socket closed"), "socket closed"],
    ["a plain string", "refused", "refused"],
    ["null", null, "null"],
  ])("logs the reason and retries once when the read rejects with %s", async (_name, rejection, reason) => {
    fetchBlob.mockRejectedValue(rejection);
    prefetcher.schedule(item("next"), 10_000);

    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Next tune prefetch failed",
      expect.objectContaining({ reason, willRetry: true }),
    );
    await vi.advanceTimersByTimeAsync(PREFETCH_RETRY_MS);
    expect(fetchBlob).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when a rejected read belongs to a cancelled schedule", async () => {
    let rejectRead: (reason: Error) => void = () => undefined;
    fetchBlob.mockImplementation(() => new Promise<Blob | null>((_, reject) => (rejectRead = reject)));
    prefetcher.schedule(item("next"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    prefetcher.cancel();
    rejectRead(new Error("aborted"));
    await vi.advanceTimersByTimeAsync(PREFETCH_RETRY_MS * 2);

    expect(addLog).not.toHaveBeenCalled();
    expect(fetchBlob).toHaveBeenCalledTimes(1);
  });

  it("skips a queued read that was cancelled while it waited for the previous read to finish", async () => {
    fetchBlob.mockImplementationOnce(
      (_item: PlaylistItem, s: AbortSignal) =>
        new Promise<Blob | null>((resolve) => s.addEventListener("abort", () => setTimeout(() => resolve(null), 8000))),
    );
    prefetcher.schedule(item("one"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);
    prefetcher.schedule(item("two"), 10_000);
    await vi.advanceTimersByTimeAsync(PREFETCH_SETTLE_MS);

    prefetcher.cancel();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchBlob).toHaveBeenCalledTimes(1);
  });
});
