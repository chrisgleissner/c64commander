/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

/**
 * One owner of this phone's speaker, enforced rather than assumed.
 *
 * The app has two independent ways to make sound here, and they knew nothing
 * about each other:
 *
 *   - the **local SID engine**, rendering a tune on this device;
 *   - the **A/V mirror**, playing the C64's own audio streamed over UDP.
 *
 * Each guarded itself against itself. Nothing guarded them against each other,
 * so any path that started one while the other was live played two different
 * pieces of music at once. The "Listen on" control stops the mirror when you
 * pick "This device", but that is one path in the UI — turning Live View audio
 * on from Home, or restoring it on load, walks straight past it. A user cannot
 * be expected to know which of two sounds to chase.
 *
 * So ownership lives here, below both, and the rule is simply: **the last
 * source to start wins, and everyone else is stopped.** Sound cannot overlap
 * even if a caller upstream forgets, because there is no code path that starts
 * audio without passing through {@link claimPhoneAudio}.
 *
 * The eviction is logged at warn (not error) because it is now a legitimate
 * outcome — starting local playback while the mirror is up *should* silence the
 * mirror — but it stays visible so an unexpected one can be traced.
 *
 * ## The crossfade exemption
 *
 * A crossfade is the one time two sounds may legitimately overlap. It happens
 * *within* one source — the local engine fading one tune into the next — so it
 * never reaches this registry: the same owner re-claiming is a no-op. Two
 * different sources are never a crossfade.
 */
export type PhoneAudioSource = "local-sid" | "av-mirror";

interface PhoneAudioOwner {
  readonly source: PhoneAudioSource;
  /** Silence this owner. Must be safe to call when already stopped. */
  readonly stop: () => void;
  /** Identity within a source, so one engine re-claiming is not an eviction. */
  readonly token: object;
}

let owner: PhoneAudioOwner | null = null;

/**
 * Take the speaker for `source`, stopping whoever held it.
 *
 * `token` identifies the individual claimant: the same engine re-opening a sink
 * for its next tune must not evict itself.
 */
export const claimPhoneAudio = (source: PhoneAudioSource, token: object, stop: () => void): void => {
  const previous = owner;
  if (previous && previous.token !== token) {
    addLog("warn", "Audio: stopping one source so another can play", {
      service: "audio",
      stopped: previous.source,
      started: source,
      detail:
        previous.source === source
          ? "Two claimants of the same audio source were live at once; that is an ownership bug upstream."
          : "Only one source may drive this device's speaker, so the previous one was stopped.",
    });
    owner = null;
    // Stop AFTER clearing, so a stop() that releases ownership cannot wipe the
    // claim we are about to install.
    previous.stop();
  }
  owner = { source, token, stop };
};

/** Give up the speaker, if `token` still holds it. */
export const releasePhoneAudio = (token: object): void => {
  if (owner?.token === token) owner = null;
};

/** Which source currently owns the speaker, or null. Used by tests and diagnostics. */
export const phoneAudioOwner = (): PhoneAudioSource | null => owner?.source ?? null;

/** Test seam: forget any owner without stopping it. */
export const __resetPhoneAudioOwnership = (): void => {
  owner = null;
};
