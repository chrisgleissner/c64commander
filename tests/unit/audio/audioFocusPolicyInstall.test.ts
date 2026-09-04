/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: vi.fn(() => true),
  getPlatform: vi.fn(() => "android"),
}));

vi.mock("@/lib/native/streamUdp", () => ({
  StreamUdp: {
    addListener: vi.fn(),
    requestAudioFocus: vi.fn(async () => ({ granted: true })),
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

import {
  __resetAudioFocusPolicy,
  installAudioFocusPolicy,
  reacquirePlaybackAudioFocus,
} from "@/lib/audio/audioFocusPolicy";
import { __resetPhoneAudioOwnership, claimPhoneAudio } from "@/lib/audio/phoneAudioOwnership";
import { resetMachineExecution } from "@/lib/deviceInteraction/machineExecutionStore";
import { addLog } from "@/lib/logging";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { StreamUdp } from "@/lib/native/streamUdp";

const addListener = vi.mocked(StreamUdp.addListener as unknown as (...args: unknown[]) => Promise<unknown>);
const requestAudioFocus = vi.mocked(StreamUdp.requestAudioFocus);

/**
 * The subscription and the focus re-request, which the policy's own tests do not reach because
 * they drive `handleAudioFocusChange` directly. Both are gated on native Android and both have a
 * failure path that must not throw into whatever asked for them.
 */
describe("audio focus policy: installation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue("android");
    requestAudioFocus.mockResolvedValue({ granted: true });
    __resetPhoneAudioOwnership();
    __resetAudioFocusPolicy();
    resetMachineExecution();
  });

  afterEach(() => {
    __resetPhoneAudioOwnership();
    __resetAudioFocusPolicy();
  });

  it("does not subscribe off native, and its disposer is safe to call", () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);

    const dispose = installAudioFocusPolicy();

    expect(addListener).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it("does not subscribe on a native platform that is not Android", () => {
    vi.mocked(getPlatform).mockReturnValue("ios");

    installAudioFocusPolicy();

    expect(addListener).not.toHaveBeenCalled();
  });

  it("forwards a native focus change to the policy", async () => {
    const remove = vi.fn(async () => undefined);
    let emit: ((event: { change: string }) => void) | null = null;
    addListener.mockImplementation((_name: unknown, listener: unknown) => {
      emit = listener as (event: { change: string }) => void;
      return Promise.resolve({ remove });
    });
    const pause = vi.fn();
    claimPhoneAudio("local-sid", {}, vi.fn(), { pause, resume: vi.fn() });

    installAudioFocusPolicy();
    await Promise.resolve();
    emit?.({ change: "loss-transient" });

    expect(addListener).toHaveBeenCalledWith("audiofocus", expect.any(Function));
    expect(pause).toHaveBeenCalled();
  });

  it("ignores an event that arrives after the disposer ran", async () => {
    const remove = vi.fn(async () => undefined);
    let emit: ((event: { change: string }) => void) | null = null;
    addListener.mockImplementation((_name: unknown, listener: unknown) => {
      emit = listener as (event: { change: string }) => void;
      return Promise.resolve({ remove });
    });
    const pause = vi.fn();
    claimPhoneAudio("local-sid", {}, vi.fn(), { pause, resume: vi.fn() });

    const dispose = installAudioFocusPolicy();
    await Promise.resolve();
    dispose();
    emit?.({ change: "loss-transient" });

    expect(pause).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  // The registration is asynchronous, so a disposer can run before the handle exists. Without the
  // cancelled check the listener would outlive the caller with nothing holding a reference to
  // remove it.
  it("removes a registration that resolves after the disposer ran", async () => {
    const remove = vi.fn(async () => undefined);
    let resolveRegistration: ((value: { remove: () => Promise<void> }) => void) | null = null;
    addListener.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegistration = resolve as (value: { remove: () => Promise<void> }) => void;
        }),
    );

    const dispose = installAudioFocusPolicy();
    dispose();
    resolveRegistration?.({ remove });
    await Promise.resolve();
    await Promise.resolve();

    expect(remove).toHaveBeenCalled();
  });

  it("logs a failed registration rather than raising it", async () => {
    addListener.mockRejectedValue(new Error("plugin missing"));

    expect(() => installAudioFocusPolicy()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "Failed to register the audio-focus listener",
      expect.objectContaining({ error: "plugin missing" }),
    );
  });
});

describe("audio focus policy: taking focus back for a resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue("android");
    requestAudioFocus.mockResolvedValue({ granted: true });
  });

  it("asks the sink for focus again on native Android", async () => {
    await reacquirePlaybackAudioFocus();

    expect(requestAudioFocus).toHaveBeenCalledTimes(1);
  });

  it("does nothing off native Android, where there is no such sink", async () => {
    vi.mocked(isNativePlatform).mockReturnValue(false);
    await reacquirePlaybackAudioFocus();
    vi.mocked(isNativePlatform).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue("ios");
    await reacquirePlaybackAudioFocus();

    expect(requestAudioFocus).not.toHaveBeenCalled();
  });

  // A refused request must not fail the resume: the tune plays either way, it just plays without
  // the focus that would have told the next interruption about it.
  it("logs a refused request rather than failing the resume", async () => {
    requestAudioFocus.mockRejectedValue(new Error("focus denied"));

    await expect(reacquirePlaybackAudioFocus()).resolves.toBeUndefined();

    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "Could not take audio focus back for the resuming source",
      expect.objectContaining({ error: "focus denied" }),
    );
  });
});
