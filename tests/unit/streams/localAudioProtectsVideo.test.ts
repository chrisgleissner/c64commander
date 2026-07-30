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
import { chooseAudioBufferSignals } from "@/lib/streams/avMirrorSession";
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

describe("which buffer the governor is told about when both paths play", () => {
  /**
   * Calls the production decision, `chooseAudioBufferSignals`, rather than reimplementing it. The first
   * version of these tests recomputed the arithmetic locally and therefore stayed green against the
   * unfixed wiring — no test at all. The function is exported for exactly this reason.
   *
   * What it decides: whichever path is closer to running dry is the one to protect, and the nominal
   * depth handed to the governor must describe THAT path. A reported nominal moves the "critical" bar
   * from 25 ms to 0, because a small native buffer is expected rather than starvation — so dropping it
   * while feeding the mirror's shallow depth is exactly how a healthy native buffer gets read as
   * starving, and video shed for nothing.
   *
   * The depths differ by three orders of magnitude by design: on-device playback holds seconds so a
   * busy JS thread cannot starve it, the native mirror sink tens of milliseconds so input stays in
   * step. So the minimum is almost always the mirror's — precisely the case that used to lose it.
   */
  const MIRROR_NOMINAL = 40;

  it("takes the mirror's buffer AND keeps its nominal when the mirror is the tighter of the two", () => {
    expect(
      chooseAudioBufferSignals({
        localActive: true,
        localBufferedMs: 12_000,
        mirrorLive: true,
        mirrorBufferedMs: 15,
        mirrorNominalBufferMs: MIRROR_NOMINAL,
      }),
    ).toEqual({ audioBufferMs: 15, audioNominalBufferMs: MIRROR_NOMINAL });
  });

  it("takes the local buffer and drops the mirror's nominal when local is the tighter", () => {
    // The nominal describes the native sink; it says nothing about a Web Audio buffer, so carrying it
    // over would tell the governor a deep buffer is a shallow one that is fine.
    expect(
      chooseAudioBufferSignals({
        localActive: true,
        localBufferedMs: 120,
        mirrorLive: true,
        mirrorBufferedMs: 900,
        mirrorNominalBufferMs: MIRROR_NOMINAL,
      }),
    ).toEqual({ audioBufferMs: 120, audioNominalBufferMs: undefined });
  });

  it("uses the mirror alone when no tune is playing on this device", () => {
    expect(
      chooseAudioBufferSignals({
        localActive: false,
        localBufferedMs: 0,
        mirrorLive: true,
        mirrorBufferedMs: 15,
        mirrorNominalBufferMs: MIRROR_NOMINAL,
      }),
    ).toEqual({ audioBufferMs: 15, audioNominalBufferMs: MIRROR_NOMINAL });
  });

  it("uses the local buffer alone when the mirror is not live", () => {
    expect(
      chooseAudioBufferSignals({
        localActive: true,
        localBufferedMs: 8_000,
        mirrorLive: false,
        mirrorBufferedMs: 0,
        mirrorNominalBufferMs: MIRROR_NOMINAL,
      }),
    ).toEqual({ audioBufferMs: 8_000, audioNominalBufferMs: undefined });
  });
});
