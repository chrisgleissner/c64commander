/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasActiveInputRelease: vi.fn(() => true),
  releaseActiveRemoteInput: vi.fn(async () => {}),
  clearToastsOnDeviceSwitch: vi.fn(),
  setHealthCheckStateSnapshot: vi.fn(),
  resetMachineExecution: vi.fn(),
  isBackgroundExecutionActive: vi.fn(() => true),
  stopBackgroundExecution: vi.fn(async () => {}),
  setDueAtMs: vi.fn(async () => {}),
  getSavedDeviceById: vi.fn((id: string) => ({ id, host: `${id}.local` })),
  getRegisteredQueryClient: vi.fn(() => ({ id: "query-client" })),
  invalidateForSavedDeviceSwitch: vi.fn(),
  toast: vi.fn(),
  addLog: vi.fn(),
  drainKernalFallbackInjectionQueue: vi.fn(),
  hasActivePlaybackToStop: vi.fn(() => true),
  stopActivePlaybackBeforeDeviceSwitch: vi.fn(async () => {}),
  stopAll: vi.fn(async () => {}),
  startVideo: vi.fn(async () => {}),
  startAudio: vi.fn(async () => {}),
}));

const mirror = { videoLive: false, audioLive: false };

vi.mock("@/lib/remoteInput/activeInputRelease", () => ({
  hasActiveInputRelease: mocks.hasActiveInputRelease,
  releaseActiveRemoteInput: mocks.releaseActiveRemoteInput,
}));
vi.mock("@/lib/remoteInput/kernalFallbackInjector", () => ({
  drainKernalFallbackInjectionQueue: mocks.drainKernalFallbackInjectionQueue,
}));
vi.mock("@/lib/uiErrors", () => ({ clearToastsOnDeviceSwitch: mocks.clearToastsOnDeviceSwitch }));
vi.mock("@/lib/diagnostics/healthCheckState", () => ({
  setHealthCheckStateSnapshot: mocks.setHealthCheckStateSnapshot,
}));
vi.mock("@/lib/deviceInteraction/machineExecutionStore", () => ({
  resetMachineExecution: mocks.resetMachineExecution,
}));
vi.mock("@/lib/native/backgroundExecutionManager", () => ({
  isBackgroundExecutionActive: mocks.isBackgroundExecutionActive,
  stopBackgroundExecution: mocks.stopBackgroundExecution,
}));
vi.mock("@/lib/native/backgroundExecution", () => ({ BackgroundExecution: { setDueAtMs: mocks.setDueAtMs } }));
vi.mock("@/lib/savedDevices/store", () => ({ getSavedDeviceById: mocks.getSavedDeviceById }));
vi.mock("@/lib/query/queryClientRegistry", () => ({ getRegisteredQueryClient: mocks.getRegisteredQueryClient }));
vi.mock("@/lib/query/c64QueryInvalidation", () => ({
  invalidateForSavedDeviceSwitch: mocks.invalidateForSavedDeviceSwitch,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/logging", () => ({ addLog: mocks.addLog }));
vi.mock("@/lib/playback/activePlaybackSession", () => ({
  hasActivePlaybackToStop: mocks.hasActivePlaybackToStop,
  stopActivePlaybackBeforeDeviceSwitch: mocks.stopActivePlaybackBeforeDeviceSwitch,
}));
vi.mock("@/lib/streams/avMirrorSession", () => ({
  avMirrorSession: {
    get videoLive() {
      return mirror.videoLive;
    },
    get audioLive() {
      return mirror.audioLive;
    },
    stopAll: mocks.stopAll,
    startVideo: mocks.startVideo,
    startAudio: mocks.startAudio,
  },
}));

import {
  hasLiveAvMirror,
  prepareForDeviceRetarget,
  readAvMirrorRetargetState,
  restartAvMirrorAfterDeviceRetarget,
  stopAvMirrorForDeviceRetarget,
} from "@/lib/connection/deviceRetarget";

describe("prepareForDeviceRetarget (HARD19-012)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockClear());
    mocks.hasActiveInputRelease.mockReturnValue(true);
    mocks.isBackgroundExecutionActive.mockReturnValue(true);
    mocks.getSavedDeviceById.mockImplementation((id: string) => ({ id, host: `${id}.local` }));
    mocks.getRegisteredQueryClient.mockReturnValue({ id: "query-client" });
    mocks.hasActivePlaybackToStop.mockReturnValue(true);
    mirror.videoLive = false;
    mirror.audioLive = false;
  });

  it("runs every cross-device hygiene step on a real device change", async () => {
    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.releaseActiveRemoteInput).toHaveBeenCalledTimes(1);
    // HARD19-017: pending kernal-fallback injections are drained so PETSCII does
    // not land on the new device.
    expect(mocks.drainKernalFallbackInjectionQueue).toHaveBeenCalledTimes(1);
    expect(mocks.clearToastsOnDeviceSwitch).toHaveBeenCalledWith("device-a.local");
    expect(mocks.setHealthCheckStateSnapshot).toHaveBeenCalledWith({ latestResult: null });
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
    expect(mocks.stopBackgroundExecution).toHaveBeenCalledTimes(1);
    expect(mocks.setDueAtMs).toHaveBeenCalledWith({ dueAtMs: null });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Playback controls detached" }));
    expect(mocks.invalidateForSavedDeviceSwitch).toHaveBeenCalledWith({ id: "query-client" });
  });

  // HARD27-010: the reachable-saved-device fallback used to retarget with the tune still playing
  // and the mirror still bound to the old device, so Live View kept showing device A while the app
  // reported device B. The stop now lives in the shared sequence both switch paths run.
  it("stops active playback and the live A/V mirror before the retarget, and reports what was live", async () => {
    mirror.videoLive = true;
    mirror.audioLive = true;

    const state = await prepareForDeviceRetarget("device-a", "device-b");

    expect(state).toEqual({ videoWasLive: true, audioWasLive: true });
    expect(mocks.stopActivePlaybackBeforeDeviceSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.stopAll).toHaveBeenCalledTimes(1);
    // Both stops must precede every step that can retarget or re-attribute the app to the new
    // device, so they land on the machine that is actually playing/streaming.
    expect(mocks.stopActivePlaybackBeforeDeviceSwitch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stopAll.mock.invocationCallOrder[0],
    );
    expect(mocks.stopAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resetMachineExecution.mock.invocationCallOrder[0],
    );
    expect(mocks.stopAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invalidateForSavedDeviceSwitch.mock.invocationCallOrder[0],
    );
  });

  it("does not touch playback or the mirror when neither is running", async () => {
    mocks.hasActivePlaybackToStop.mockReturnValue(false);

    const state = await prepareForDeviceRetarget("device-a", "device-b");

    expect(state).toEqual({ videoWasLive: false, audioWasLive: false });
    expect(mocks.stopActivePlaybackBeforeDeviceSwitch).not.toHaveBeenCalled();
    expect(mocks.stopAll).not.toHaveBeenCalled();
  });

  it("completes the retarget when the mirror stop never settles", async () => {
    vi.useFakeTimers();
    try {
      mirror.videoLive = true;
      mocks.stopAll.mockReturnValueOnce(new Promise<void>(() => {}));

      const pending = prepareForDeviceRetarget("device-a", "device-b");
      await vi.advanceTimersByTimeAsync(1500);

      await expect(pending).resolves.toEqual({ videoWasLive: true, audioWasLive: false });
      expect(mocks.invalidateForSavedDeviceSwitch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a warning and still returns when the mirror stop rejects", async () => {
    mirror.audioLive = true;
    mocks.stopAll.mockRejectedValueOnce(new Error("receiver unbind failed"));

    await expect(prepareForDeviceRetarget("device-a", "device-b")).resolves.toEqual({
      videoWasLive: false,
      audioWasLive: true,
    });

    expect(mocks.addLog).toHaveBeenCalledWith(
      "warn",
      "Live View: failed to stop the A/V mirror before device retarget",
      expect.objectContaining({ fromDeviceId: "device-a" }),
    );
  });

  it("skips remote-input release when nothing is holding input", async () => {
    mocks.hasActiveInputRelease.mockReturnValue(false);

    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.releaseActiveRemoteInput).not.toHaveBeenCalled();
    // The rest of the hygiene still runs.
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
  });

  it("does not clear toasts/health when there is no distinct previous device (cold start)", async () => {
    await prepareForDeviceRetarget(null, "device-b");

    expect(mocks.clearToastsOnDeviceSwitch).not.toHaveBeenCalled();
    expect(mocks.setHealthCheckStateSnapshot).not.toHaveBeenCalled();
    // Machine-execution reset is device-agnostic and still runs.
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
    // No background stop without a previous device.
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
  });

  it("does not treat retargeting to the same device id as a device change", async () => {
    await prepareForDeviceRetarget("device-a", "device-a");

    expect(mocks.clearToastsOnDeviceSwitch).not.toHaveBeenCalled();
    expect(mocks.setHealthCheckStateSnapshot).not.toHaveBeenCalled();
    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
  });

  it("skips the background-execution stop when nothing is running", async () => {
    mocks.isBackgroundExecutionActive.mockReturnValue(false);

    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.stopBackgroundExecution).not.toHaveBeenCalled();
    expect(mocks.setDueAtMs).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("skips query invalidation when no query client is registered yet (pre-UI startup)", async () => {
    mocks.getRegisteredQueryClient.mockReturnValue(null);

    await prepareForDeviceRetarget("device-a", "device-b");

    expect(mocks.invalidateForSavedDeviceSwitch).not.toHaveBeenCalled();
    // Everything else still runs.
    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
  });

  it("still completes hygiene when a native stop step rejects", async () => {
    mocks.stopBackgroundExecution.mockRejectedValueOnce(new Error("native down"));

    await expect(prepareForDeviceRetarget("device-a", "device-b")).resolves.toEqual({
      videoWasLive: false,
      audioWasLive: false,
    });

    expect(mocks.resetMachineExecution).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateForSavedDeviceSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.addLog).toHaveBeenCalled();
  });

  it("still toasts and completes hygiene when clearing the native due-time rejects", async () => {
    mocks.setDueAtMs.mockRejectedValueOnce(new Error("due-time clear failed"));

    await expect(prepareForDeviceRetarget("device-a", "device-b")).resolves.toEqual({
      videoWasLive: false,
      audioWasLive: false,
    });

    expect(mocks.stopBackgroundExecution).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Playback controls detached" }));
    expect(mocks.invalidateForSavedDeviceSwitch).toHaveBeenCalledTimes(1);
    expect(mocks.addLog).toHaveBeenCalled();
  });
});

describe("stopAvMirrorForDeviceRetarget / restartAvMirrorAfterDeviceRetarget (HARD27-010)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockClear());
    mirror.videoLive = false;
    mirror.audioLive = false;
  });

  it("reports each stream separately and only claims work when one is live", () => {
    mirror.videoLive = true;

    const state = readAvMirrorRetargetState();

    expect(state).toEqual({ videoWasLive: true, audioWasLive: false });
    expect(hasLiveAvMirror(state)).toBe(true);
    expect(hasLiveAvMirror({ videoWasLive: false, audioWasLive: false })).toBe(false);
  });

  it("stops both streams through the session's single stop entry point", async () => {
    await stopAvMirrorForDeviceRetarget("device-a");

    expect(mocks.stopAll).toHaveBeenCalledTimes(1);
  });

  it("restarts exactly the streams that were live before the retarget", () => {
    restartAvMirrorAfterDeviceRetarget({ videoWasLive: true, audioWasLive: false }, "device-b");

    expect(mocks.startVideo).toHaveBeenCalledTimes(1);
    expect(mocks.startAudio).not.toHaveBeenCalled();
  });

  it("restarts nothing when the mirror was off", () => {
    restartAvMirrorAfterDeviceRetarget({ videoWasLive: false, audioWasLive: false }, "device-b");

    expect(mocks.startVideo).not.toHaveBeenCalled();
    expect(mocks.startAudio).not.toHaveBeenCalled();
  });

  // The two restarts are separate fire-and-forget calls with separate handlers, so covering one
  // says nothing about the other.
  it("logs a failed video restart instead of rejecting into the caller", async () => {
    mocks.startVideo.mockRejectedValueOnce(new Error("streams:start refused"));

    expect(() =>
      restartAvMirrorAfterDeviceRetarget({ videoWasLive: true, audioWasLive: false }, "device-b"),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.startVideo).toHaveBeenCalledTimes(1);
  });

  it("logs a restart failure instead of rejecting into the caller", async () => {
    mocks.startAudio.mockRejectedValueOnce(new Error("streams:start refused"));

    restartAvMirrorAfterDeviceRetarget({ videoWasLive: false, audioWasLive: true }, "device-b");
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.addLog).toHaveBeenCalledWith(
      "warn",
      "Live View: failed to restart audio on the new device after retarget",
      expect.objectContaining({ toDeviceId: "device-b" }),
    );
  });
});
