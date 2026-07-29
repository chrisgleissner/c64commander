/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Live View must give way to a tune playing on this device.
 *
 * The governor already sheds video to protect audio — that is what the priority order is for — but it
 * could only see the MIRROR's audio. A tune rendered here was invisible to it, so Live View kept
 * painting at full rate while the on-device engine, which renders on a worker but is *scheduled* from
 * the main thread, was starved of the CPU it needed to stay ahead of the clock.
 *
 * Measured on a Pixel 4 with the timing barcode (`tools/hil/audio_e2e_probe.py`): local playback on
 * its own loses one note in 102; with Live View video also running it loses eleven in forty seconds,
 * most of them a half or a third short. A listener hears that as frequent silent gaps, and it gets
 * worse the longer the app has been up — exactly the conditions that squeeze the main thread.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { StreamGovernor } from "@/lib/streams/streamGovernor";
import {
  __resetLocalAudioHealth,
  clearLocalAudioHealth,
  readLocalAudioHealth,
  reportLocalAudioHealth,
} from "@/lib/streams/localAudioHealthSignal";

describe("the on-device engine's health signal", () => {
  beforeEach(() => __resetLocalAudioHealth());

  it("starts inactive, so nothing is protected before a tune plays", () => {
    expect(readLocalAudioHealth()).toEqual({ active: false, bufferedMs: 0, underruns: 0 });
  });

  it("carries what the governor needs to judge starvation", () => {
    reportLocalAudioHealth({ active: true, bufferedMs: 120, underruns: 4 });
    expect(readLocalAudioHealth()).toEqual({ active: true, bufferedMs: 120, underruns: 4 });
  });

  it("goes quiet when playback stops, so video is not held down for ever", () => {
    // Without this the mirror would keep protecting a tune that finished, and Live View would stay
    // demoted for the rest of the session with nothing to show for it.
    reportLocalAudioHealth({ active: true, bufferedMs: 120, underruns: 4 });
    clearLocalAudioHealth();
    expect(readLocalAudioHealth().active).toBe(false);
  });
});

describe("the governor sheds video for a starving on-device tune", () => {
  const settings = () => new StreamGovernor();

  it("demotes when the engine is running thin", () => {
    // The same response it already gives a starving mirror. What changed is only that it can now see
    // this engine at all.
    const governor = settings();
    const before = governor.update(
      { audioBufferMs: 400, audioUnderruns: 0, audioActive: true, videoQueueAgeMs: 0 },
      0,
    ).effectiveFraction;
    const after = governor.update(
      { audioBufferMs: 5, audioUnderruns: 6, audioActive: true, videoQueueAgeMs: 0 },
      250,
    ).effectiveFraction;
    expect(after).toBeLessThan(before);
  });

  it("leaves video alone when no audio is playing at all", () => {
    // A video-only mirror has no player, so its buffer reads 0 — which must not be mistaken for
    // starvation and peg the picture to the floor.
    const governor = settings();
    const fraction = governor.update(
      { audioBufferMs: 0, audioUnderruns: 0, audioActive: false, videoQueueAgeMs: 0 },
      0,
    ).effectiveFraction;
    expect(fraction).toBe(1);
  });
});
