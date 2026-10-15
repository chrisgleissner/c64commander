/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addLog, addErrorLog } = vi.hoisted(() => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));
vi.mock("@/lib/logging", () => ({ addLog, addErrorLog }));

import { usePauseMute, type SidMuteSnapshot } from "@/pages/playFiles/hooks/usePauseMute";
import type { AudioMixerItem } from "@/pages/playFiles/playFilesUtils";

const SID_ITEM = { name: "Vol Master", value: "0 dB", options: ["OFF", "0 dB"] } as AudioMixerItem;
const SNAPSHOT: SidMuteSnapshot = {
  volumes: { "Vol Master": "0 dB" },
  enablement: {} as SidMuteSnapshot["enablement"],
};

const setup = (overrides: Partial<Parameters<typeof usePauseMute>[0]> = {}) => {
  const options = {
    enabledSidVolumeItems: [SID_ITEM],
    sidEnablement: {} as SidMuteSnapshot["enablement"],
    captureSidMuteSnapshot: vi.fn(() => SNAPSHOT),
    buildEnabledSidMuteUpdates: vi.fn(() => ({ "Vol Master": "OFF" })),
    snapshotToUpdates: vi.fn(() => ({ "Vol Master": "0 dB" }) as Record<string, string | number>),
    applyAudioMixerUpdates: vi.fn().mockResolvedValue(undefined),
    ensureUnmuted: vi.fn().mockResolvedValue(undefined),
    isManualMuteHeld: () => false,
    dispatchVolume: vi.fn(),
    pauseMuteSnapshotRef: { current: null as SidMuteSnapshot | null },
    pausingFromPauseRef: { current: false },
    resumingFromPauseRef: { current: false },
    ...overrides,
  };
  const { result } = renderHook(() => usePauseMute(options));
  return { options, mute: result.current };
};

describe("usePauseMute", () => {
  beforeEach(() => {
    addLog.mockReset();
    addErrorLog.mockReset();
  });

  it("skips the pause mute and clears its state when no SID outputs are known", async () => {
    const { options, mute } = setup({ enabledSidVolumeItems: [] });
    options.pauseMuteSnapshotRef.current = SNAPSHOT;
    options.pausingFromPauseRef.current = true;

    await mute.muteBeforeMachinePause();

    expect(options.applyAudioMixerUpdates).not.toHaveBeenCalled();
    expect(options.pauseMuteSnapshotRef.current).toBeNull();
    expect(options.pausingFromPauseRef.current).toBe(false);
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("no cached SID mixer items"));
  });

  it("marks the pause mute without a mixer write when every output is already at its muted value", async () => {
    const { options, mute } = setup({ buildEnabledSidMuteUpdates: vi.fn(() => ({})) });

    await mute.muteBeforeMachinePause();

    expect(options.applyAudioMixerUpdates).not.toHaveBeenCalled();
    expect(options.pauseMuteSnapshotRef.current).toBe(SNAPSHOT);
    expect(options.dispatchVolume).toHaveBeenCalledWith({ type: "mute", reason: "pause" });
  });

  it("restores the saved volumes for every output when the current outputs are not known on resume", async () => {
    const snapshotToUpdates = vi.fn((snapshot: SidMuteSnapshot | null | undefined, items?: AudioMixerItem[]) =>
      items ? {} : { ...(snapshot?.volumes ?? {}) },
    );
    const { options, mute } = setup({ enabledSidVolumeItems: [], snapshotToUpdates });
    options.pauseMuteSnapshotRef.current = SNAPSHOT;

    await mute.unmuteAfterMachineResume();

    expect(options.applyAudioMixerUpdates).toHaveBeenCalledWith({ "Vol Master": "0 dB" }, "Resume unmute");
    expect(options.resumingFromPauseRef.current).toBe(true);
  });

  it("falls back to the whole saved snapshot when none of its outputs is among the current ones", async () => {
    const snapshotToUpdates = vi.fn((snapshot: SidMuteSnapshot | null | undefined, items?: AudioMixerItem[]) =>
      items ? {} : { ...(snapshot?.volumes ?? {}) },
    );
    const { options, mute } = setup({ snapshotToUpdates });
    options.pauseMuteSnapshotRef.current = SNAPSHOT;

    await mute.unmuteAfterMachineResume();

    expect(options.applyAudioMixerUpdates).toHaveBeenCalledWith({ "Vol Master": "0 dB" }, "Resume unmute");
    expect(options.ensureUnmuted).not.toHaveBeenCalled();
  });

  it("does nothing on a failed pause that never muted", async () => {
    const { options, mute } = setup();

    await mute.rollbackMuteAfterFailedPause(new Error("pause failed"));

    expect(options.applyAudioMixerUpdates).not.toHaveBeenCalled();
    expect(options.ensureUnmuted).not.toHaveBeenCalled();
    expect(options.dispatchVolume).not.toHaveBeenCalled();
  });

  it("unmutes through the device's own state when a failed pause left nothing to restore", async () => {
    const { options, mute } = setup({ enabledSidVolumeItems: [], snapshotToUpdates: vi.fn(() => ({})) });
    options.pausingFromPauseRef.current = true;

    await mute.rollbackMuteAfterFailedPause("busy");

    expect(options.ensureUnmuted).toHaveBeenCalledWith({ force: true, refreshItems: true });
    expect(options.dispatchVolume).toHaveBeenCalledWith({ type: "unmute", reason: "pause" });
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("rolled back"), {
      updateCount: 0,
      pauseError: "busy",
    });
    expect(options.pausingFromPauseRef.current).toBe(false);
  });

  it("logs the rollback failure with both errors and still clears the pause state", async () => {
    const { options, mute } = setup({
      applyAudioMixerUpdates: vi.fn().mockRejectedValue("mixer unreachable"),
    });
    options.pauseMuteSnapshotRef.current = SNAPSHOT;
    options.pausingFromPauseRef.current = true;
    options.resumingFromPauseRef.current = true;

    await mute.rollbackMuteAfterFailedPause(new Error("pause failed"));

    expect(addErrorLog).toHaveBeenCalledWith("Playback pause mute rollback failed", {
      error: "mixer unreachable",
      pauseError: "pause failed",
    });
    expect(options.pauseMuteSnapshotRef.current).toBeNull();
    expect(options.pausingFromPauseRef.current).toBe(false);
    expect(options.resumingFromPauseRef.current).toBe(false);
  });
});
