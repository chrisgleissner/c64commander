/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { interruptPhoneAudio, phoneAudioOwnerToken, type PhoneAudioSource } from "@/lib/audio/phoneAudioOwnership";
import {
  resumeMachineExecutionIfPausedBy,
  setMachineExecutionPaused,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { StreamUdp, type StreamUdpAudioFocusChange } from "@/lib/native/streamUdp";

/**
 * What the app does when something else on the phone takes the speaker (HARD27-006).
 *
 * The native sink requests audio focus while it is open, so a loss arrives whichever of the two
 * sources is playing. Which one it is decides what "stop" means, and that is known here rather than
 * natively: a tune suspends its clock and keeps its position, the A/V mirror stops receiving.
 *
 * A transient loss (a navigation prompt, a call) is restored on the following gain; a permanent one
 * is not, because the other app is still playing and restarting over it is the failure this is
 * meant to end. Ducking never reaches a decision here — the pipeline has already attenuated the
 * samples it owns by the time the event crosses the bridge.
 */
let interrupted: { source: PhoneAudioSource; token: object; resume: () => void } | null = null;

export const handleAudioFocusChange = (change: StreamUdpAudioFocusChange): void => {
  if (change === "duck") return;

  if (change === "gain") {
    const pending = interrupted;
    interrupted = null;
    if (!pending) return;
    // Somebody else took the speaker while we were interrupted; restoring would be the two-sounds
    // failure phoneAudioOwnership exists to prevent.
    const currentToken = phoneAudioOwnerToken();
    if (currentToken !== null && currentToken !== pending.token) return;
    addLog("info", "Audio focus regained; resuming", { service: "audio", source: pending.source });
    if (pending.source === "local-sid") resumeMachineExecutionIfPausedBy("audio-focus");
    pending.resume();
    return;
  }

  const target = interruptPhoneAudio();
  if (!target) return;
  interrupted = change === "loss-transient" ? target : null;
  addLog("info", "Audio focus lost; silencing this app", {
    service: "audio",
    source: target.source,
    transient: change === "loss-transient",
  });
  // A tune has a transport the user can see. Writing the shared execution state is what makes the
  // Play page's Pause/Play button agree with what the listener is hearing, whether or not it is
  // mounted at the time. The mirror has no such state — its own control follows the session.
  if (target.source === "local-sid") setMachineExecutionPaused({ pausedBy: "audio-focus" });
};

/**
 * Subscribe to the native sink's focus events. Returns a cleanup; a no-op off native Android, where
 * no such sink exists.
 */
export const installAudioFocusPolicy = (): (() => void) => {
  if (!isNativePlatform() || getPlatform() !== "android") return () => undefined;

  let cancelled = false;
  let handle: { remove: () => Promise<void> } | null = null;

  void StreamUdp.addListener("audiofocus", (event) => {
    if (cancelled) return;
    handleAudioFocusChange(event.change);
  })
    .then((registered) => {
      if (cancelled) {
        void registered.remove();
        return;
      }
      handle = registered;
    })
    .catch((error: unknown) => {
      addLog("warn", "Failed to register the audio-focus listener", {
        service: "audio",
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return () => {
    cancelled = true;
    void handle?.remove();
  };
};

/** Test seam: forget any interruption without resuming it. */
export const __resetAudioFocusPolicy = (): void => {
  interrupted = null;
};
