/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  areBackgroundReadsSuspended,
  beginInteractiveWriteBurst,
  beginMachineTransition,
  beginPlaybackWriteBurst,
  getDeviceActivitySnapshot,
  isMachineTransitionActive,
  isPlaybackWriteBurstActive,
  resetDeviceActivityGate,
  subscribeDeviceActivityGate,
  waitForBackgroundReadsToResume,
  waitForMachineTransitionsToSettle,
} from "@/lib/deviceInteraction/deviceActivityGate";

beforeEach(() => {
  resetDeviceActivityGate();
  vi.useFakeTimers();
});

afterEach(() => {
  resetDeviceActivityGate();
  vi.useRealTimers();
});

describe("deviceActivityGate – initial state", () => {
  it("has zeroed snapshot after reset", () => {
    const snap = getDeviceActivitySnapshot();
    expect(snap.machineTransitionCount).toBe(0);
    expect(snap.playbackWriteCount).toBe(0);
    expect(snap.machineTransitionCooldownUntilMs).toBe(0);
    expect(snap.playbackWriteCooldownUntilMs).toBe(0);
  });

  it("isMachineTransitionActive is false when idle", () => {
    expect(isMachineTransitionActive()).toBe(false);
  });

  it("isPlaybackWriteBurstActive is false when idle", () => {
    expect(isPlaybackWriteBurstActive()).toBe(false);
  });

  it("areBackgroundReadsSuspended is false when idle", () => {
    expect(areBackgroundReadsSuspended()).toBe(false);
  });
});

describe("beginMachineTransition", () => {
  it("increments machineTransitionCount and marks transition active", () => {
    const end = beginMachineTransition(0);
    expect(isMachineTransitionActive()).toBe(true);
    expect(getDeviceActivitySnapshot().machineTransitionCount).toBe(1);
    end();
  });

  it("decrements on end and applies cooldown", () => {
    const end = beginMachineTransition(250);
    end();
    expect(getDeviceActivitySnapshot().machineTransitionCount).toBe(0);
    // Still active due to cooldown
    expect(isMachineTransitionActive()).toBe(true);
  });

  it("clears after cooldown expires", () => {
    const end = beginMachineTransition(250);
    end();
    vi.advanceTimersByTime(300);
    expect(isMachineTransitionActive()).toBe(false);
  });

  it("calling end twice is idempotent", () => {
    const end = beginMachineTransition(0);
    end();
    end(); // second call should be a no-op
    expect(getDeviceActivitySnapshot().machineTransitionCount).toBe(0);
  });

  it("suspends background reads while active", () => {
    const end = beginMachineTransition(0);
    expect(areBackgroundReadsSuspended()).toBe(true);
    end();
  });
});

describe("beginPlaybackWriteBurst", () => {
  it("increments playbackWriteCount and marks burst active", () => {
    const end = beginPlaybackWriteBurst(0);
    expect(isPlaybackWriteBurstActive()).toBe(true);
    expect(getDeviceActivitySnapshot().playbackWriteCount).toBe(1);
    end();
  });

  it("decrements on end and applies cooldown", () => {
    const end = beginPlaybackWriteBurst(150);
    end();
    expect(getDeviceActivitySnapshot().playbackWriteCount).toBe(0);
    expect(isPlaybackWriteBurstActive()).toBe(true);
  });

  it("clears after cooldown expires", () => {
    const end = beginPlaybackWriteBurst(150);
    end();
    vi.advanceTimersByTime(200);
    expect(isPlaybackWriteBurstActive()).toBe(false);
  });

  it("suspends background reads while active", () => {
    const end = beginPlaybackWriteBurst(0);
    expect(areBackgroundReadsSuspended()).toBe(true);
    end();
  });
});

describe("beginInteractiveWriteBurst", () => {
  it("is an alias for beginPlaybackWriteBurst", () => {
    const end = beginInteractiveWriteBurst(0);
    expect(isPlaybackWriteBurstActive()).toBe(true);
    end();
  });
});

describe("subscribeDeviceActivityGate", () => {
  it("notifies listener on state change", () => {
    const listener = vi.fn();
    const unsub = subscribeDeviceActivityGate(listener);
    const end = beginMachineTransition(0);
    expect(listener).toHaveBeenCalled();
    end();
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsub = subscribeDeviceActivityGate(listener);
    unsub();
    listener.mockClear();
    beginMachineTransition(0)();
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies on reset", () => {
    const listener = vi.fn();
    const unsub = subscribeDeviceActivityGate(listener);
    resetDeviceActivityGate();
    expect(listener).toHaveBeenCalled();
    unsub();
  });
});

describe("waitForMachineTransitionsToSettle", () => {
  it("resolves immediately when no transition is active", async () => {
    await expect(waitForMachineTransitionsToSettle()).resolves.toBeUndefined();
  });

  it("resolves when active transition ends", async () => {
    const end = beginMachineTransition(0);
    const promise = waitForMachineTransitionsToSettle();
    end();
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("waitForBackgroundReadsToResume", () => {
  it("resolves immediately when nothing is active", async () => {
    await expect(waitForBackgroundReadsToResume()).resolves.toBeUndefined();
  });

  it("resolves when playback burst ends and cooldown clears", async () => {
    const end = beginPlaybackWriteBurst(0);
    const promise = waitForBackgroundReadsToResume();
    end();
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("snapshot is frozen", () => {
  it("returns a frozen object", () => {
    expect(Object.isFrozen(getDeviceActivitySnapshot())).toBe(true);
  });
});
