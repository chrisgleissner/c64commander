/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { avMirrorSession, type AvMirrorSession } from "@/lib/streams/avMirrorSession";

/** What the mirror was doing when the app was hidden, so becoming visible can put it back. */
export interface AvMirrorSuspendedState {
  audioWasLive: boolean;
  videoWasLive: boolean;
}

/**
 * HARD27-021: Live View had no lifecycle policy. Hiding the app left the native receiver running,
 * the phone playing the C64's audio with no notification and no control, and the Ultimate
 * multicasting 2.6 MB/s of video onto the Wi-Fi. If the OS then killed the process the device was
 * never told to stop.
 *
 * The policy is stop-on-hide, restore-on-show, which is the same shape the device switch already
 * uses. Chosen over running the mirror under the background-execution foreground service because
 * the mirror has no lock-screen controls: a stream the user cannot see, hear a reason for, or stop
 * is exactly the state this finding is about.
 */
export class AvMirrorBackgroundPolicy {
  private suspended: AvMirrorSuspendedState | null = null;

  constructor(
    private readonly session: Pick<
      AvMirrorSession,
      "audioLive" | "videoLive" | "stopAll" | "startAudio" | "startVideo"
    >,
  ) {}

  /** What is being held for restore, or `null` when the mirror was not live when the app was hidden. */
  get suspendedState(): AvMirrorSuspendedState | null {
    return this.suspended;
  }

  async handleHidden(): Promise<void> {
    if (this.suspended) return;
    const state: AvMirrorSuspendedState = {
      audioWasLive: this.session.audioLive,
      videoWasLive: this.session.videoLive,
    };
    if (!state.audioWasLive && !state.videoWasLive) return;
    this.suspended = state;
    addLog("info", "Live View: stopping the mirror while the app is hidden", {
      service: "streams",
      audioWasLive: state.audioWasLive,
      videoWasLive: state.videoWasLive,
    });
    await this.session.stopAll();
  }

  async handleVisible(): Promise<void> {
    const state = this.suspended;
    if (!state) return;
    this.suspended = null;
    // Only restart what is still stopped. A device retarget, or the user reaching the controls
    // first, can have restarted a stream already, and a second start would open it twice.
    if (state.videoWasLive && !this.session.videoLive) {
      await this.session.startVideo().catch((error: unknown) => {
        addLog("warn", "Live View: failed to restart video after the app became visible", {
          service: "streams",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    if (state.audioWasLive && !this.session.audioLive) {
      await this.session.startAudio().catch((error: unknown) => {
        addLog("warn", "Live View: failed to restart audio after the app became visible", {
          service: "streams",
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }
}

/**
 * Wire the shared session to `visibilitychange`, the idiom the rest of the app already uses for
 * backgrounding. Returns a disposer. Kept out of {@link AvMirrorSession} so unit tests can drive an
 * isolated policy without touching the document.
 */
export function installAvMirrorBackgroundPolicy(
  policy: AvMirrorBackgroundPolicy = new AvMirrorBackgroundPolicy(avMirrorSession),
): () => void {
  const handleVisibilityChange = () => {
    void (document.hidden ? policy.handleHidden() : policy.handleVisible());
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}
