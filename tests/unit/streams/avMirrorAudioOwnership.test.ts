/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Captured {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

// Hoisted so the arrays exist before the module's `avMirrorSession` singleton
// constructs its controllers at import time.
const { audioInstances, videoInstances } = vi.hoisted(() => ({
  audioInstances: [] as Captured[],
  videoInstances: [] as Captured[],
}));

vi.mock("@/lib/streams/audioMirrorController", () => ({
  AudioMirrorController: class {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    isOnWifi = vi.fn(() => false);
    constructor() {
      audioInstances.push(this as unknown as Captured);
    }
  },
}));

vi.mock("@/lib/streams/videoMirrorController", () => ({
  VideoMirrorController: class {
    start = vi.fn(async () => {});
    stop = vi.fn(async () => {});
    setKeepFraction = vi.fn();
    constructor() {
      videoInstances.push(this as unknown as Captured);
    }
  },
}));

import { AvMirrorSession } from "@/lib/streams/avMirrorSession";
import { __resetPhoneAudioOwnership, claimPhoneAudio, phoneAudioOwner } from "@/lib/audio/phoneAudioOwnership";

/**
 * The mirror has to take part in speaker ownership, not merely respect it in
 * the UI.
 *
 * "Listen on → This device" stops the mirror, but that is one path through one
 * control. Turning Live View audio on from Home, or restoring it on load, never
 * touches it — and then the C64's audio plays on top of the tune rendering here.
 */
describe("A/V mirror audio and the phone's speaker", () => {
  const makeSession = () => {
    audioInstances.length = 0;
    videoInstances.length = 0;
    const session = new AvMirrorSession({ startStream: vi.fn(async () => ({})), stopStream: vi.fn(async () => ({})) });
    return { session, audio: audioInstances[0]! };
  };

  beforeEach(() => {
    __resetPhoneAudioOwnership();
  });

  it("silences a local tune when the mirror's audio starts", async () => {
    const stopLocalTune = vi.fn();
    claimPhoneAudio("local-sid", {}, stopLocalTune);
    const { session } = makeSession();

    await session.startAudio();

    expect(stopLocalTune).toHaveBeenCalledTimes(1);
    expect(phoneAudioOwner()).toBe("av-mirror");
  });

  it("claims the speaker before opening the stream", async () => {
    // Claiming after would let the first packets play over the tune.
    const order: string[] = [];
    claimPhoneAudio("local-sid", {}, () => order.push("local stopped"));
    const { session, audio } = makeSession();
    audio.start.mockImplementation(async () => {
      order.push("stream started");
    });

    await session.startAudio();

    expect(order).toEqual(["local stopped", "stream started"]);
  });

  it("gives the speaker back when the mirror's audio stops", async () => {
    const { session } = makeSession();
    await session.startAudio();

    await session.stopAudio();

    expect(phoneAudioOwner()).toBeNull();
  });

  it("does not keep holding the speaker when the stream fails to start", async () => {
    // Nothing is playing, so a local tune must still be able to start.
    const { session, audio } = makeSession();
    audio.start.mockRejectedValueOnce(new Error("device refused to stream"));

    await expect(session.startAudio()).rejects.toThrow(/refused/);

    expect(phoneAudioOwner()).toBeNull();
  });

  it("stops the mirror's stream when a local tune takes the speaker", async () => {
    const { session, audio } = makeSession();
    await session.startAudio();

    claimPhoneAudio("local-sid", {}, vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    // Stopping the controller is what actually ends the UDP intake — the device
    // is told to stop streaming and the sink is released.
    expect(audio.stop).toHaveBeenCalled();
  });
});
