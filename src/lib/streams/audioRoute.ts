/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Pure Live View audio-route decisions (firmware PR #732 `wifi=true`). The
 * firmware can deliver an **audio-only** stream over Wi‑Fi, which never coexists
 * with video, so these rules only decide the route for audio and how video
 * interacts with a Wi‑Fi audio stream. Kept pure so the policy is unit-tested
 * without touching the session, the device, or the network.
 */

import type { StreamAudioRoute } from "@/lib/config/appSettings";

export interface AudioWifiDecision {
  policy: StreamAudioRoute;
  /** Is a video stream currently live (or connecting)? */
  videoActive: boolean;
}

/**
 * Should an audio stream **start** request Wi‑Fi? Only when the policy allows it
 * AND audio is the only stream — Wi‑Fi audio cannot run alongside video.
 */
export function shouldUseWifiForAudio({ policy, videoActive }: AudioWifiDecision): boolean {
  if (policy === "ethernet") return false;
  return !videoActive;
}

/** What starting video should do given the current audio route. */
export type VideoStartAction =
  /** Just start video (audio is on Ethernet, or not running). */
  | "start"
  /** Move the Wi‑Fi audio to Ethernet first, then start video (share one route). */
  | "convert-audio-then-start"
  /** Refuse video: the `wifi` policy keeps audio on Wi‑Fi, which video can't join. */
  | "blocked";

export function resolveVideoStartAction({
  policy,
  audioOnWifi,
}: {
  policy: StreamAudioRoute;
  audioOnWifi: boolean;
}): VideoStartAction {
  if (!audioOnWifi) return "start";
  // Audio is on Wi‑Fi and video can't share it.
  if (policy === "wifi") return "blocked";
  return "convert-audio-then-start";
}

/**
 * When video stops, should audio that we forced onto Ethernet move back to
 * Wi‑Fi? Only under the `dynamic` policy, and only if we were the ones who moved
 * it (so an `ethernet`/`wifi` choice is never overridden).
 */
export function shouldReturnAudioToWifi({
  policy,
  audioForcedToEthernet,
}: {
  policy: StreamAudioRoute;
  audioForcedToEthernet: boolean;
}): boolean {
  return policy === "dynamic" && audioForcedToEthernet;
}
