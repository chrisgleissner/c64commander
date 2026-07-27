/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetPhoneAudioOwnership,
  claimPhoneAudio,
  phoneAudioOwner,
  releasePhoneAudio,
} from "@/lib/audio/phoneAudioOwnership";

/**
 * One sound at a time from this device.
 *
 * The app can make sound two independent ways — the local SID engine rendering
 * a tune here, and the A/V mirror playing the C64's audio over UDP. Each used to
 * guard only against itself, so any path that started one while the other was
 * live played two different pieces of music at once, and the listener had no way
 * to tell which control stopped which.
 */
describe("phone audio ownership", () => {
  beforeEach(() => {
    __resetPhoneAudioOwnership();
  });

  it("stops the mirror when a local tune starts", () => {
    const stopMirror = vi.fn();
    claimPhoneAudio("av-mirror", {}, stopMirror);

    claimPhoneAudio("local-sid", {}, vi.fn());

    expect(stopMirror).toHaveBeenCalledTimes(1);
    expect(phoneAudioOwner()).toBe("local-sid");
  });

  it("stops a local tune when the mirror starts", () => {
    const stopLocal = vi.fn();
    claimPhoneAudio("local-sid", {}, stopLocal);

    claimPhoneAudio("av-mirror", {}, vi.fn());

    expect(stopLocal).toHaveBeenCalledTimes(1);
    expect(phoneAudioOwner()).toBe("av-mirror");
  });

  it("does not evict the same claimant re-opening its sink", () => {
    // A crossfade is one source fading its own tune into the next. It must not
    // read as a second source, or every track change would stop itself.
    const engine = {};
    const stop = vi.fn();
    claimPhoneAudio("local-sid", engine, stop);

    claimPhoneAudio("local-sid", engine, stop);

    expect(stop).not.toHaveBeenCalled();
    expect(phoneAudioOwner()).toBe("local-sid");
  });

  it("evicts a second claimant of the same source", () => {
    // Two engines both holding a sink is the eight-concurrent-streams bug. Same
    // source, different claimant, so it is still an eviction.
    const stopFirst = vi.fn();
    claimPhoneAudio("local-sid", {}, stopFirst);

    claimPhoneAudio("local-sid", {}, vi.fn());

    expect(stopFirst).toHaveBeenCalledTimes(1);
  });

  it("leaves the speaker free after the owner releases it", () => {
    const token = {};
    claimPhoneAudio("local-sid", token, vi.fn());

    releasePhoneAudio(token);

    expect(phoneAudioOwner()).toBeNull();
  });

  it("ignores a release from someone who no longer owns the speaker", () => {
    // The mirror's stop path releases unconditionally. If that could clear a
    // claim the local engine had just taken, the next local tune would start
    // with no owner recorded and the guard would be blind.
    const mirror = {};
    claimPhoneAudio("av-mirror", mirror, vi.fn());
    claimPhoneAudio("local-sid", {}, vi.fn());

    releasePhoneAudio(mirror);

    expect(phoneAudioOwner()).toBe("local-sid");
  });

  it("keeps the new owner when the evicted one releases from inside its stop", () => {
    // Real stops call release on their way out. Ordering matters: if the claim
    // were installed before the eviction ran, that release would wipe it.
    const mirror = {};
    claimPhoneAudio("av-mirror", mirror, () => releasePhoneAudio(mirror));

    claimPhoneAudio("local-sid", {}, vi.fn());

    expect(phoneAudioOwner()).toBe("local-sid");
  });
});
