/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetAudioFocusPolicy, handleAudioFocusChange } from "@/lib/audio/audioFocusPolicy";
import { __resetPhoneAudioOwnership, claimPhoneAudio } from "@/lib/audio/phoneAudioOwnership";
import {
  getMachineExecutionSnapshot,
  resetMachineExecution,
  setMachineExecutionPaused,
} from "@/lib/deviceInteraction/machineExecutionStore";

/**
 * HARD27-006: another app taking the speaker.
 *
 * Neither native audio sink asked for audio focus and the one focus request the app made had a
 * listener that logged and did nothing, so starting a podcast while a tune played left both
 * playing. These drive the production policy directly — the native plugin only classifies the
 * platform's focus change and forwards it here.
 */
describe("audio focus policy", () => {
  beforeEach(() => {
    __resetPhoneAudioOwnership();
    __resetAudioFocusPolicy();
    resetMachineExecution();
  });

  const claimLocalSid = () => {
    const pause = vi.fn();
    const resume = vi.fn();
    claimPhoneAudio("local-sid", {}, vi.fn(), { pause, resume });
    return { pause, resume };
  };

  it("pauses a local tune on a transient loss and resumes it on the following gain", () => {
    const { pause, resume } = claimLocalSid();

    handleAudioFocusChange("loss-transient");
    expect(pause).toHaveBeenCalledTimes(1);
    expect(getMachineExecutionSnapshot()).toMatchObject({ state: "paused", pausedBy: "audio-focus" });

    handleAudioFocusChange("gain");
    expect(resume).toHaveBeenCalledTimes(1);
    expect(getMachineExecutionSnapshot().state).toBe("running");
  });

  it("does not resume after a permanent loss", () => {
    // The other app is still playing. Starting again over the top of it is the failure this exists
    // to end, so a permanent loss is the app's last word until the user asks for playback again.
    const { pause, resume } = claimLocalSid();

    handleAudioFocusChange("loss");
    handleAudioFocusChange("gain");

    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(getMachineExecutionSnapshot()).toMatchObject({ state: "paused", pausedBy: "audio-focus" });
  });

  it("stops the A/V mirror on a loss without touching the machine's execution state", () => {
    // The C64 is not paused by anything happening on the phone, so claiming it is would make the
    // Play page's transport lie about a machine it never touched.
    const pause = vi.fn();
    const resume = vi.fn();
    claimPhoneAudio("av-mirror", {}, vi.fn(), { pause, resume });

    handleAudioFocusChange("loss-transient");
    expect(pause).toHaveBeenCalledTimes(1);
    expect(getMachineExecutionSnapshot().state).toBe("running");

    handleAudioFocusChange("gain");
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("leaves a new owner alone when focus comes back", () => {
    const interruptedEngine = claimLocalSid();
    handleAudioFocusChange("loss-transient");

    // The user started Live View while the tune was silenced; that is now what owns the speaker.
    const mirrorResume = vi.fn();
    claimPhoneAudio("av-mirror", {}, vi.fn(), { pause: vi.fn(), resume: mirrorResume });

    handleAudioFocusChange("gain");

    expect(interruptedEngine.resume).not.toHaveBeenCalled();
    expect(mirrorResume).not.toHaveBeenCalled();
  });

  it("does not resume a pause the user set while focus was lost", () => {
    // A user pause outlives the focus loss: only a pause tagged "audio-focus" is the policy's to
    // undo, which is what resumeMachineExecutionIfPausedBy enforces.
    claimLocalSid();
    handleAudioFocusChange("loss-transient");
    setMachineExecutionPaused({ pausedBy: "user" });

    handleAudioFocusChange("gain");

    expect(getMachineExecutionSnapshot()).toMatchObject({ state: "paused", pausedBy: "user" });
  });

  it("ignores a duck, which the native pipeline has already applied", () => {
    const { pause } = claimLocalSid();

    handleAudioFocusChange("duck");

    expect(pause).not.toHaveBeenCalled();
  });
});
