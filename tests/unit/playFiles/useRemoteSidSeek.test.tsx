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
vi.mock("@/lib/c64api", () => ({ getC64API: () => ({}) }));
vi.mock("@/lib/deviceCapabilities", () => ({
  probeMachineInputCapability: async () => ({ status: machineInput.status }),
}));
vi.mock("@/lib/savedDevices/store", () => ({ getSelectedSavedDevice: () => ({ id: "c64u" }) }));
vi.mock("@/lib/playback/playbackRouter", () => ({
  getRememberedUltimateSidBlob: () => null,
  tryFetchUltimateSidBlob: async () => null,
}));
vi.mock("@/lib/playback/remoteSeek/activeRemoteSidSeek", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/playback/remoteSeek/activeRemoteSidSeek")>();
  return { ...original, createRemoteSeekApi: () => device.current?.api };
});

import { useRemoteSidSeek } from "@/pages/playFiles/hooks/useRemoteSidSeek";

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

const rsid = () => {
  const bytes = Uint8Array.from(SEEKABLE);
  bytes.set([0x52, 0x53, 0x49, 0x44], 0);
  return bytes;
};

const render = (options: { item?: PlaylistItem; active?: boolean; elapsedMs?: number } = {}) => {
  const rebasePlaybackPosition = vi.fn();
  const hook = renderHook(
    (props: { active: boolean; elapsedMs: number }) =>
      useRemoteSidSeek({
        item: options.item ?? item(),
        active: props.active,
        trackInstanceId: 1,
        deviceInfo: DEVICE_INFO,
        elapsedMs: props.elapsedMs,
        durationMs: 180_000,
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

const rebasedSeconds = (mock: ReturnType<typeof vi.fn>) => (mock.mock.calls.at(-1)?.[0] ?? NaN) / 1000;

describe("useRemoteSidSeek", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    machineInput.status = "available";
    device.current = createFakeRemoteSeekDevice();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers the gestures once it has found the SID player on the C64's screen", async () => {
    const { result } = render();
    expect(result.current.handlers).toBeNull();
    await advance(1500);
    expect(result.current.handlers?.onScrubStep).toBeTypeOf("function");
    expect(result.current.handlers?.onSeekToFraction).toBeTypeOf("function");
  });

  it("leaves Previous and Next as track controls for an RSID tune", async () => {
    const { result } = render({ item: item(rsid()) });
    await advance(1500);
    expect(result.current.handlers).toBeNull();
  });

  it("leaves them as track controls on a machine that takes no key input", async () => {
    machineInput.status = "unsupported-family";
    const { result } = render();
    await advance(1500);
    expect(result.current.handlers).toBeNull();
  });

  it("fast forwards while Next is held and lands the progress display where the C64 is", async () => {
    const { result, rebasePlaybackPosition } = render();
    await advance(1500);
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
    await advance(1500);
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
    expect(result.current.targetMs).toBeCloseTo((from - 10) * 1000, -2);
    await advance(1000);
    expect(result.current.targetMs).toBeCloseTo((from - 30) * 1000, -2);
    act(() => result.current.handlers?.onScrubEnd?.());
    await advance(5000);
    expect(device.current!.player.restarts).toBe(2);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeGreaterThan(from - 31);
    expect(rebasedSeconds(rebasePlaybackPosition)).toBeLessThan(from - 25);
  });

  it("gives the device back when the app is hidden mid fast forward", async () => {
    const { result } = render();
    await advance(1500);
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
    expect(result.current.targetMs).toBeNull();
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
  });

  it("gives the device back when playback stops being remote mid fast forward", async () => {
    const { result, rerender } = render();
    await advance(1500);
    act(() => {
      result.current.handlers?.onScrubStart?.();
      result.current.handlers?.onScrubStep?.(5);
    });
    await advance(1500);
    rerender({ active: false, elapsedMs: 0 });
    await advance(2000);
    expect(result.current.handlers).toBeNull();
    expect(device.current!.player.heldKeys).toEqual([]);
    expect(device.current!.settings["CPU Speed"]).toBe(" 1");
  });
});
