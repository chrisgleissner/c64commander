/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The Play page's bridge between the transport gestures and remote seeking, against the simulated
 * SID player: which tunes get the gestures at all, what each gesture does on the C64, and that the
 * progress display lands where the C64 did.
 */

import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeRemoteSeekDevice } from "../playback/remoteSeek/fakeRemoteSeekDevice";
import type { PlaylistItem } from "@/pages/playFiles/types";

const machineInput = vi.hoisted(() => ({ status: "available" }));
const device = vi.hoisted(() => ({ current: null as ReturnType<typeof createFakeRemoteSeekDevice> | null }));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
const toasts = vi.hoisted(() => ({ shown: [] as Array<{ title?: string; description?: string }> }));
vi.mock("@/hooks/use-toast", () => ({
  toast: (notice: { title?: string; description?: string }) => void toasts.shown.push(notice),
}));
const replays = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/c64api", () => ({
  getC64API: () => ({
    playSidUpload: async () => {
      replays.count += 1;
      device.current?.player.replayTune();
      return { errors: [] };
    },
  }),
}));
const parked = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/playback/launchSafety", () => ({
  withCartridgeParked: async <T,>(_api: unknown, run: () => Promise<T>) => {
    parked.count += 1;
    return run();
  },
}));
vi.mock("@/lib/deviceCapabilities", () => ({
  probeMachineInputCapability: async () => ({ status: machineInput.status }),
}));
vi.mock("@/lib/savedDevices/store", () => ({ getSelectedSavedDevice: () => ({ id: "c64u" }) }));
const ultimateBlob = vi.hoisted(() => ({ bytes: null as Uint8Array | null }));
vi.mock("@/lib/playback/playbackRouter", () => ({
  getRememberedUltimateSidBlob: () => null,
  tryFetchUltimateSidBlob: async () =>
    ultimateBlob.bytes ? { arrayBuffer: async () => ultimateBlob.bytes!.slice().buffer } : null,
}));
vi.mock("@/lib/playback/remoteSeek/activeRemoteSidSeek", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/playback/remoteSeek/activeRemoteSidSeek")>();
  return { ...original, createRemoteSeekApi: () => device.current?.api };
});

import { useRemoteSidSeek } from "@/pages/playFiles/hooks/useRemoteSidSeek";
import { cancelRemoteSidSeek } from "@/lib/playback/remoteSeek/activeRemoteSidSeek";

const SEEKABLE = Uint8Array.from(readFileSync(path.resolve("playwright/fixtures/remote-seek/seekable.sid")));
const DEVICE_INFO = { product: "C64 Ultimate", core_version: "1.50", firmware_version: "1.2.1" } as never;

const item = (bytes: Uint8Array = SEEKABLE, overrides: Partial<PlaylistItem> = {}): PlaylistItem =>
  ({
    id: "tune",
    label: "seekable.sid",
    path: "/seekable.sid",
    category: "sid",
    request: {
      source: "local",
      path: "/seekable.sid",
      file: { name: "seekable.sid", lastModified: 0, arrayBuffer: async () => bytes.slice().buffer },
    },
    ...overrides,
  }) as PlaylistItem;

/** The same tune with its sub tune timed by CIA 1 timer A, whose rate has to be measured on the C64. */
const ciaTimed = () => {
  const bytes = Uint8Array.from(SEEKABLE);
  bytes.set([0, 0, 0, 1], 0x12);
  return bytes;
};

const rsid = () => {
  const bytes = Uint8Array.from(SEEKABLE);
  bytes.set([0x52, 0x53, 0x49, 0x44], 0);
  return bytes;
};

const render = (options: { item?: PlaylistItem; active?: boolean; elapsedMs?: number; durationMs?: number } = {}) => {
  const rebasePlaybackPosition = vi.fn();
  const hook = renderHook(
    (props: { active: boolean; elapsedMs: number; paused?: boolean }) =>
      useRemoteSidSeek({
        item: options.item === null ? undefined : (options.item ?? item()),
        active: props.active,
        paused: props.paused ?? false,
        trackInstanceId: 1,
        deviceInfo: ("deviceInfo" in options ? options.deviceInfo : DEVICE_INFO) as never,
        elapsedMs: props.elapsedMs,
        durationMs: "durationMs" in options ? options.durationMs : 180_000,
        rebasePlaybackPosition,
      }),
    { initialProps: { active: options.active ?? true, elapsedMs: options.elapsedMs ?? 0 } },
  );
  return { ...hook, rebasePlaybackPosition };
};

const advance = async (ms: number) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  }
};

/** The probe starts 800 ms into a tune and watches the player's clock tick for 1.2 s. */
const PROBED_MS = 2500;

const rebasedSeconds = (mock: ReturnType<typeof vi.fn>) => (mock.mock.calls.at(-1)?.[0] ?? NaN) / 1000;

describe("useRemoteSidSeek", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    machineInput.status = "available";
    ultimateBlob.bytes = null;
    replays.count = 0;
    parked.count = 0;
    toasts.shown.length = 0;
    device.current = createFakeRemoteSeekDevice();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the gestures once it has found the SID player on the C64's screen", async () => {
    const { result } = render();
    expect(result.current.handlers).toBeNull();
    await advance(PROBED_MS);
    expect(result.current.handlers?.onScrubStep).toBeTypeOf("function");
    expect(result.current.handlers?.onSeekToFraction).toBeTypeOf("function");
  });

  it("measures a CIA-timed tune's play-call rate in the background before any gesture", async () => {
    const read = device.current!.api.readMemory;
    let timerReads = 0;
    device.current!.api.readMemory = async (address, length, options) => {
      if (address === "DC04") timerReads += 1;
      return read(address, length, options);
    };
    const { result } = render({ item: item(ciaTimed()) });
    await advance(5000);
    expect(result.current.handlers).not.toBeNull();
    expect(timerReads).toBe(100);
  });

  it("logs a play-call rate it could not measure, and measures it again for the first gesture", async () => {
    const { addLog } = await import("@/lib/logging");
    const read = device.current!.api.readMemory;
    let failing = true;
    device.current!.api.readMemory = async (address, length, options) => {
      if (failing && address === "DC04") throw new Error("HTTP 503");
      return read(address, length, options);
    };
    const { result, rebasePlaybackPosition } = render({ item: item(ciaTimed()) });
    await advance(PROBED_MS);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Remote seek could not measure the tune's play-call rate",
      expect.objectContaining({ error: "HTTP 503" }),
    );
    failing = false;
    act(() => {
      result.current.handlers?.onSeekToFraction?.(0.5);
    });
    await advance(8000);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeGreaterThan(89);
  });

  /** The page's position after its last rebase, at `now`, against where the simulated clock is. */
  const shownAgainstClock = (rebase: ReturnType<typeof vi.fn>) => {
    const [positionMs] = rebase.mock.calls.at(-1) ?? [NaN];
    const rebasedAt = rebase.mock.invocationCallOrder.length ? rebaseTimes.at(-1)! : NaN;
    return positionMs + (Date.now() - rebasedAt) - device.current!.player.tunePositionSeconds * 1000;
  };
  const rebaseTimes: number[] = [];
  const timedRebase = () => {
    rebaseTimes.length = 0;
    return (positionMs: number) => {
      rebaseTimes.push(Date.now());
      return positionMs;
    };
  };

  it("puts the page's elapsed time on the C64's own second once it has found the player", async () => {
    vi.setSystemTime(5_000_000);
    device.current = createFakeRemoteSeekDevice({ latencyMs: 10 });
    const { rebasePlaybackPosition } = render();
    rebasePlaybackPosition.mockImplementation(timedRebase());
    await advance(PROBED_MS + 2000);
    expect(rebasePlaybackPosition).toHaveBeenCalled();
    expect(Math.abs(shownAgainstClock(rebasePlaybackPosition))).toBeLessThanOrEqual(30);
  });

  it("follows the C64's clock again after a landing, and every 30 seconds while it plays", async () => {
    device.current = createFakeRemoteSeekDevice({ latencyMs: 10 });
    const { result, rebasePlaybackPosition } = render();
    rebasePlaybackPosition.mockImplementation(timedRebase());
    await advance(PROBED_MS + 2000);
    act(() => result.current.handlers?.onSeekToFraction?.(0.4));
    await advance(10_000);
    expect(Math.abs(shownAgainstClock(rebasePlaybackPosition))).toBeLessThanOrEqual(30);
    const calls = rebasePlaybackPosition.mock.calls.length;
    await advance(31_000);
    expect(rebasePlaybackPosition.mock.calls.length).toBeGreaterThan(calls);
    expect(Math.abs(shownAgainstClock(rebasePlaybackPosition))).toBeLessThanOrEqual(30);
  });

  it("leaves the position to a held Next rather than following the clock under it", async () => {
    device.current = createFakeRemoteSeekDevice({ latencyMs: 10 });
    // Of unknown length, so the hold cannot reach an end and land by itself.
    const { result, rebasePlaybackPosition } = render({ durationMs: undefined });
    await advance(PROBED_MS + 2000);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    const calls = rebasePlaybackPosition.mock.calls.length;
    await advance(35_000);
    expect(rebasePlaybackPosition.mock.calls.length).toBe(calls);
    act(() => result.current.handlers?.onScrubEnd?.());
  });

  it("leaves Previous and Next as track controls for an RSID tune", async () => {
    const { result } = render({ item: item(rsid()) });
    await advance(PROBED_MS);
    expect(result.current.handlers).toBeNull();
  });

  it("fast forwards a cartridge, which takes no key input, through the player's own keyboard routine", async () => {
    machineInput.status = "unsupported-family";
    device.current = createFakeRemoteSeekDevice({ cartridge: true });
    const { result, rebasePlaybackPosition, rerender } = render();
    await advance(PROBED_MS);
    rerender({ active: true, elapsedMs: device.current.player.tunePositionSeconds * 1000 });
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(3000);
    expect(device.current.player.fastForwarding).toBe(true);
    act(() => result.current.handlers?.onScrubEnd?.());
    for (let waited = 0; rebasePlaybackPosition.mock.calls.length === 0 && waited < 3000; waited += 10)
      await advance(10);
    const { ldyOperandAddress } = device.current.player.code;
    const site = ldyOperandAddress.toString(16).toUpperCase().padStart(4, "0");
    // Held, released, and written back once more by the restore, which reads it back.
    expect(device.current.log).toEqual([`writemem ${site} 01`, `writemem ${site} 00`, `writemem ${site} 00`]);
    expect(device.current.player.fastForwarding).toBe(false);
    expect(device.current.player.tunePositionSeconds).toBeGreaterThan(20);
    expect(Math.abs(rebasedSeconds(rebasePlaybackPosition) - device.current.player.tunePositionSeconds)).toBeLessThan(
      1.5,
    );
  });

  /** Hold Next on a cartridge for 2 s, with `during` run a second in, and release. */
  const holdOnCartridge = async (during: () => void = () => undefined) => {
    const hook = render();
    await advance(PROBED_MS);
    act(() => {
      hook.result.current.handlers?.onScrubStart?.();
      hook.result.current.handlers?.onScrubStep?.(5);
    });
    await advance(1000);
    during();
    await advance(1000);
    act(() => hook.result.current.handlers?.onScrubEnd?.());
    await advance(8000);
    return hook;
  };

  it("leaves a cartridge's SID player working after a seek, and says nothing", async () => {
    machineInput.status = "unsupported-family";
    device.current = createFakeRemoteSeekDevice({ cartridge: true });
    const { result } = await holdOnCartridge();
    expect(device.current.player.playerIntact).toBe(true);
    expect(result.current.handlers).not.toBeNull();
    expect(toasts.shown).toEqual([]);
  });

  /** Writes of 0 to the `ldy` operand are dropped `count` times, as a release that never lands. */
  const dropReleases = (count: number) => {
    const { ldyOperandAddress } = device.current!.player.code;
    const site = ldyOperandAddress.toString(16).toUpperCase().padStart(4, "0");
    const write = device.current!.api.writeMemory;
    let dropped = 0;
    device.current!.api.writeMemory = (address, data) => {
      if (address === site && data[0] === 0 && dropped < count) {
        dropped += 1;
        return Promise.resolve({});
      }
      return write(address, data);
    };
  };

  it("releases a fast forward a seek left held, says once that the firmware does not support seeking, and skips tracks", async () => {
    machineInput.status = "unsupported-family";
    device.current = createFakeRemoteSeekDevice({ cartridge: true });
    dropReleases(5);
    const { result, unmount } = await holdOnCartridge();
    expect(device.current.player.fastForwarding).toBe(false);
    expect(device.current.player.playerIntact).toBe(true);
    expect(replays.count).toBe(0);
    expect(result.current.handlers).toBeNull();
    expect(toasts.shown).toHaveLength(1);
    expect(toasts.shown[0].title).toBe("Seeking not supported");
    expect(toasts.shown[0].description).toContain("firmware 1.2.1");
    unmount();

    // The next tune on the same firmware gets plain track controls at once, and no second notice.
    const writes = device.current.log.length;
    const next = render();
    await advance(PROBED_MS + 2000);
    expect(next.result.current.handlers).toBeNull();
    expect(device.current.log.length).toBe(writes);
    expect(toasts.shown).toHaveLength(1);
  });

  it("starts the tune again to reload a SID player whose fast forward cannot be released", async () => {
    machineInput.status = "unsupported-family";
    device.current = createFakeRemoteSeekDevice({ cartridge: true });
    dropReleases(Number.POSITIVE_INFINITY);
    await holdOnCartridge();
    expect(replays.count).toBe(1);
    expect(device.current.player.fastForwarding).toBe(false);
    expect(toasts.shown).toHaveLength(1);
  });

  it("leaves a SID player that something else changed alone, and keeps seeking", async () => {
    machineInput.status = "unsupported-family";
    device.current = createFakeRemoteSeekDevice({ cartridge: true });
    const { storeAddress } = device.current.player.code;
    // Another program's code where the player's `rts` was: not the seek's doing, and not its to write.
    const { result } = await holdOnCartridge(() =>
      device.current!.player.writeMemory(storeAddress + 3, Uint8Array.of(0xea)),
    );
    expect(device.current.player.playerIntact).toBe(false);
    expect(replays.count).toBe(0);
    expect(toasts.shown).toEqual([]);
    expect(result.current.handlers).not.toBeNull();
  });

  it("rewinds a cartridge by starting the tune afresh, with the cartridge parked as for any SID", async () => {
    machineInput.status = "unsupported-family";
    device.current = createFakeRemoteSeekDevice({ cartridge: true });
    const { result, rebasePlaybackPosition, rerender } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.3));
    await advance(10_000);
    rerender({ active: true, elapsedMs: rebasedSeconds(rebasePlaybackPosition) * 1000 });
    const rebasesBefore = rebasePlaybackPosition.mock.calls.length;
    act(() => result.current.handlers?.onSeekToFraction?.(0.1));
    await advance(10_000);
    expect(replays.count).toBe(1);
    expect(parked.count).toBe(1);
    // The landing; later rebases follow the clock on from there.
    const landedMs = rebasePlaybackPosition.mock.calls[rebasesBefore]?.[0] ?? NaN;
    expect(Math.abs(landedMs / 1000 - 18)).toBeLessThan(2);
    expect(device.current.player.fastForwarding).toBe(false);
  });

  it("leaves Previous and Next as track controls when neither key input nor the player's routine is there", async () => {
    machineInput.status = "unsupported-family";
    device.current = createFakeRemoteSeekDevice({ cartridge: true, playerCode: null });
    const { result } = render();
    await advance(PROBED_MS + 2000);
    expect(result.current.handlers).toBeNull();
    expect(device.current.log).toEqual([]);
  });

  it("fast forwards while Next is held and lands the progress display where the C64 is", async () => {
    const { result, rebasePlaybackPosition, rerender } = render();
    await advance(PROBED_MS);
    rerender({ active: true, elapsedMs: device.current!.player.tunePositionSeconds * 1000 });
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(2500);
    expect(result.current.targetMs).toBeGreaterThan(10_000);
    act(() => result.current.handlers?.onScrubEnd?.());
    for (let waited = 0; rebasePlaybackPosition.mock.calls.length === 0 && waited < 3000; waited += 10)
      await advance(10);
    expect(result.current.targetMs).toBeNull();
    expect(Math.abs(rebasedSeconds(rebasePlaybackPosition) - device.current!.player.tunePositionSeconds)).toBeLessThan(
      1.5,
    );
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
  });

  it("moves the rewind target back 10 then 20 seconds while Previous is held, and jumps there on release", async () => {
    const { result, rebasePlaybackPosition, rerender } = render({ elapsedMs: 0 });
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onSeekToFraction?.(0.5);
    });
    await advance(5000);
    rerender({ active: true, elapsedMs: rebasedSeconds(rebasePlaybackPosition) * 1000 });
    const from = rebasedSeconds(rebasePlaybackPosition);
    expect(from).toBeGreaterThan(89);

    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(-5);
    });
    // From the landing, which the page's elapsed time has not caught up with: the tune played on since.
    const firstTarget = result.current.targetMs ?? 0;
    expect(firstTarget / 1000).toBeGreaterThan(from - 10);
    expect(firstTarget / 1000).toBeLessThan(from - 5);
    await advance(1000);
    expect(result.current.targetMs).toBeCloseTo(firstTarget - 20_000, -2);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(5000);
    expect(device.current!.player.restarts).toBe(2);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeGreaterThan((firstTarget - 20_000) / 1000 - 1);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeLessThan((firstTarget - 20_000) / 1000 + 2);
  });

  it("gives the device back when the app is hidden mid fast forward", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(PROBED_MS);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(2000);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    expect(result.current.targetMs).toBeNull();
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
  });

  it("gives the device back when playback stops being remote mid fast forward", async () => {
    const { result, rerender } = render();
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(PROBED_MS);
    rerender({ active: false, elapsedMs: 0 });
    await advance(2000);
    expect(result.current.handlers).toBeNull();
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
  });

  it("starts a jump asked for during another from where that one landed", async () => {
    const { result, rebasePlaybackPosition } = render({ elapsedMs: 0 });
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.5));
    await advance(400);
    // The first jump is under way; the elapsed time the page still reports is near 0.
    act(() => result.current.handlers?.onSeekToFraction?.(0.3));
    await advance(10000);
    // Going back from 90 s to 54 s restarts the tune; a jump started from the stale 0 s would not have.
    expect(device.current!.player.restarts).toBe(2);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeGreaterThan(53.5);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeLessThan(56);
  });

  it("rewinds from where a running jump is heading when Previous is held during it", async () => {
    const { result, rebasePlaybackPosition } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.5));
    await advance(400);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(-5);
    });
    expect((result.current.targetMs ?? 0) / 1000).toBeCloseTo(90 - 10, 0);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(20_000);
    expect(Math.abs(rebasedSeconds(rebasePlaybackPosition) - 80)).toBeLessThan(2);
  });

  it("keeps a hold when the other button is pressed too, and gives the device back on release", async () => {
    const { result, rerender } = render();
    await advance(PROBED_MS);
    rerender({ active: true, elapsedMs: 60_000 });
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(-5);
    });
    // Lifting the second finger leaves the first hold running.
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(500);
    expect(device.current!.player.heldKeys).toEqual(["arrow_left"]);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(2000);
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    expect(device.current!.player.restarts).toBe(0);
  });

  it("does not run a queued jump once the jump before it was cancelled", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.5));
    await advance(400);
    act(() => result.current.handlers?.onSeekToFraction?.(0.2));
    await advance(300);
    act(() => {
      void cancelRemoteSidSeek("stop");
    });
    await advance(1000);
    const keysAfterCancel = device.current!.log.length;
    await advance(5000);
    expect(device.current!.log.slice(keysAfterCancel).filter((entry) => entry.startsWith("key press"))).toEqual([]);
    expect(device.current!.player.restarts).toBe(0);
  });

  it("drops a drag that has not settled when the app is hidden", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.5));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await advance(3000);
    expect(device.current!.log.filter((entry) => entry.startsWith("key press"))).toEqual([]);
    expect(result.current.targetMs).toBeNull();
  });

  it("keeps a jump's target on screen while the hold before it is still being given back", async () => {
    const { result, rerender } = render();
    await advance(PROBED_MS);
    rerender({ active: true, elapsedMs: device.current!.player.tunePositionSeconds * 1000 });
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(2000);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(10);
    act(() => result.current.handlers?.onSeekToFraction?.(0.05));
    const target = result.current.targetMs;
    expect(target).not.toBeNull();
    for (let waited = 0; result.current.targetMs !== null && waited < 30_000; waited += 10) {
      expect(result.current.targetMs).toBe(target);
      await advance(10);
    }
    expect(Math.abs(device.current!.player.tunePositionSeconds - target! / 1000)).toBeLessThan(3);
  });

  it("keeps seeking offered across a pause, so Previous held right after resuming rewinds", async () => {
    const { result, rerender } = render();
    await advance(PROBED_MS);
    expect(result.current.handlers).not.toBeNull();
    rerender({ active: true, elapsedMs: 30_000, paused: true });
    await advance(10);
    expect(result.current.handlers).toBeNull();
    rerender({ active: true, elapsedMs: 30_000, paused: false });
    await advance(10);
    expect(result.current.handlers).not.toBeNull();
  });

  it("drops a tap on the bar that has not settled when Pause cancels seeking", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.5));
    await advance(10);
    let cancelled = false;
    act(() => void cancelRemoteSidSeek("pause or resume").then(() => (cancelled = true)));
    await advance(3000);
    expect(cancelled).toBe(true);
    expect(device.current!.log.filter((entry) => entry.startsWith("key press"))).toEqual([]);
    expect(result.current.targetMs).toBeNull();
  });

  it("probes again on resume when the tune was paused before its clock could be seen to tick", async () => {
    const { result, rerender } = render();
    device.current!.player.setPaused(true);
    rerender({ active: true, elapsedMs: 0, paused: true });
    await advance(PROBED_MS + 2000);
    device.current!.player.setPaused(false);
    rerender({ active: true, elapsedMs: 0, paused: false });
    await advance(PROBED_MS);
    expect(result.current.handlers).not.toBeNull();
  });

  it("does not read the C64's clock while the tune is paused", async () => {
    const { rerender } = render();
    await advance(PROBED_MS);
    rerender({ active: true, elapsedMs: 30_000, paused: true });
    // A clock measurement already under way ends by itself within 1.1 s.
    await advance(2000);
    const reads = vi.spyOn(device.current!.api, "readMemory");
    await vi.advanceTimersByTimeAsync(65_000);
    expect(reads).not.toHaveBeenCalled();
  });

  it("gives the device back when the tune is paused during a hold", async () => {
    const { result, rerender } = render();
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(1500);
    expect(device.current!.player.heldKeys).toEqual(["arrow_left"]);
    rerender({ active: true, elapsedMs: 30_000, paused: true });
    await advance(2000);
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
    expect(result.current.targetMs).toBeNull();
  });

  it("ignores the progress bar while Next is held", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(800);
    act(() => result.current.handlers?.onSeekToFraction?.(0.1));
    await advance(1000);
    // A jump would have taken the device over from the hold, releasing its key.
    expect(device.current!.log.filter((entry) => entry.startsWith("key release"))).toEqual([]);
    expect(device.current!.player.heldKeys).toEqual(["arrow_left"]);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(PROBED_MS);
    expect(device.current!.player.heldKeys).toEqual([]);
  });

  const ultimateItem = () =>
    item(SEEKABLE, { request: { source: "ultimate", path: "/USB2/seekable.sid" } } as Partial<PlaylistItem>);

  it("reads the header of a tune on the Ultimate over FTP", async () => {
    ultimateBlob.bytes = SEEKABLE;
    const { result } = render({ item: ultimateItem() });
    await advance(PROBED_MS);
    expect(result.current.handlers).not.toBeNull();
  });

  it("offers nothing when the header of a tune on the Ultimate cannot be fetched", async () => {
    const { result } = render({ item: ultimateItem() });
    await advance(PROBED_MS);
    expect(result.current.handlers).toBeNull();
  });

  it("offers nothing when the C64 is not showing the SID player", async () => {
    device.current!.api.readMemory = async (_address, length) => new Uint8Array(length);
    const { result } = render();
    await advance(5000);
    expect(result.current.handlers).toBeNull();
  });

  it("offers nothing when the probe itself fails", async () => {
    device.current!.api.readMemory = async () => {
      throw new Error("HTTP 503");
    };
    const { result } = render();
    await advance(PROBED_MS);
    expect(result.current.handlers).toBeNull();
  });

  it("keeps the bar a plain indicator when the tune's length is unknown", async () => {
    const { result } = render({ durationMs: undefined });
    await advance(PROBED_MS);
    expect(result.current.handlers?.onScrubStep).toBeTypeOf("function");
    expect(result.current.handlers?.onSeekToFraction).toBeUndefined();
    // `onSeek` only tells the card a hold is on offer; the gesture runs through the scrub handlers.
    expect(result.current.handlers?.onSeek?.(5)).toBeUndefined();
  });

  it("ends a fast forward by itself at the end of the tune", async () => {
    const { result, rebasePlaybackPosition } = render({ durationMs: 30_000 });
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(5000);
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBe(30);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(500);
    expect(device.current!.player.restarts).toBe(0);
  });

  it("clears the gesture when a fast forward cannot start", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    device.current!.failures.keyEvents = 1;
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(PROBED_MS);
    expect(result.current.targetMs).toBeNull();
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(500);
    expect(device.current!.player.heldKeys).toEqual([]);
  });

  it("rewinds at the machine's own speed when it has no CPU Speed, and a lone release does nothing", async () => {
    device.current!.api.getConfigItem = async (category, item) => {
      if (item === "CPU Speed") throw new Error("HTTP 404");
      return { [category]: { [item]: { current: "PAL", values: ["PAL"] } } } as never;
    };
    const { result, rebasePlaybackPosition, rerender } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onScrubEnd?.());
    expect(device.current!.log).toEqual([]);
    act(() => result.current.handlers?.onSeekToFraction?.(0.2));
    await advance(8000);
    rerender({ active: true, elapsedMs: rebasedSeconds(rebasePlaybackPosition) * 1000 });
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(-5);
    });
    const target = (result.current.targetMs ?? 0) / 1000;
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(8000);
    // Minus then plus: each selects a sub tune, so the simulation counts two restarts.
    expect(device.current!.player.restarts).toBe(2);
    expect(device.current!.log.filter((entry) => entry.startsWith("CPU Speed"))).toEqual([]);
    expect(Math.abs(rebasedSeconds(rebasePlaybackPosition) - target)).toBeLessThan(2);
  });

  it("jumps once, to where a drag comes to rest", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.2));
    await advance(100);
    act(() => result.current.handlers?.onSeekToFraction?.(0.4));
    await advance(5000);
    expect(device.current!.log.filter((entry) => entry === "key press arrow_left").length).toBeGreaterThan(0);
    expect(device.current!.player.tunePositionSeconds).toBeGreaterThan(72);
  });

  it("puts the page back on the C64's clock when it comes back after a hold was cancelled by hiding it", async () => {
    const { result, rebasePlaybackPosition } = render();
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(2500);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(2000);
    rebasePlaybackPosition.mockClear();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    for (let waited = 0; rebasePlaybackPosition.mock.calls.length === 0 && waited < 3000; waited += 10)
      await advance(10);
    expect(Math.abs(rebasedSeconds(rebasePlaybackPosition) - device.current!.player.tunePositionSeconds)).toBeLessThan(
      1.5,
    );
  });

  it("does not start another fast forward from a held button after hiding the app ended the first", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(1500);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(2000);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    const pressesBefore = device.current!.log.filter((entry) => entry === "key press arrow_left").length;
    // The card keeps repeating its step while the finger stays down.
    act(() => result.current.handlers?.onScrubStep?.(5));
    await advance(1000);
    expect(device.current!.log.filter((entry) => entry === "key press arrow_left")).toHaveLength(pressesBefore);
    expect(device.current!.player.heldKeys).toEqual([]);
  });

  it("ignores the page becoming visible again", async () => {
    const { result } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.2));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.targetMs).toBe(36_000);
  });

  it("offers nothing without a tune or a connected machine", async () => {
    const { result } = render({ item: null });
    const { result: unconnected } = render({ deviceInfo: null });
    await advance(PROBED_MS);
    expect(result.current.handlers).toBeNull();
    expect(unconnected.current.handlers).toBeNull();
  });

  it("stops the rewind target when the app is hidden during a Previous hold", async () => {
    const { result } = render({ elapsedMs: 120_000 });
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(-5);
    });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    await advance(3000);
    expect(result.current.targetMs).toBeNull();
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(1000);
    expect(device.current!.player.restarts).toBe(0);
  });

  it("drops a jump chain when playback leaves the C64 route mid jump", async () => {
    const { result, rerender, rebasePlaybackPosition } = render();
    await advance(PROBED_MS);
    act(() => result.current.handlers?.onSeekToFraction?.(0.5));
    await advance(500);
    rerender({ active: false, elapsedMs: 0 });
    await advance(5000);
    expect(rebasePlaybackPosition).not.toHaveBeenCalled();
    expect(device.current!.player.heldKeys).toEqual([]);
  });

  it("fast forwards a tune of unknown length until released", async () => {
    const { result, rebasePlaybackPosition } = render({ durationMs: undefined });
    await advance(PROBED_MS);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(2000);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(PROBED_MS);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeGreaterThan(15);
  });

  it("treats a fast forward stopped while it was starting as superseded, not as a failure", async () => {
    const { addErrorLog } = await import("@/lib/logging");
    const { result } = render();
    await advance(PROBED_MS);
    vi.mocked(addErrorLog).mockClear();
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
      void cancelRemoteSidSeek("stop");
    });
    await advance(PROBED_MS);
    expect(addErrorLog).not.toHaveBeenCalled();
    expect(device.current!.player.heldKeys).toEqual([]);
  });
});
