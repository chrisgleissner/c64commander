/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadMirrorC64Audio } from "@/lib/config/appSettings";
import { getMachineExecutionSnapshot } from "@/lib/deviceInteraction/machineExecutionStore";
import { isBackgroundExecutionActive } from "@/lib/native/backgroundExecutionManager";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { restoreMirrorWhenDeviceReturns } from "@/lib/connection/networkTransitions";
import { addLog } from "@/lib/logging";
import { isLocalPlaybackActive, isRemotePlaybackActive } from "@/lib/playback/activePlaybackSession";
import { subscribePlaybackActivity } from "@/lib/playback/playbackActivitySignal";
import { avMirrorSession, type AvMirrorSession } from "@/lib/streams/avMirrorSession";

/** What the mirror was doing when the app was hidden, so becoming visible can put it back. */
export interface AvMirrorSuspendedState {
  audioWasLive: boolean;
  videoWasLive: boolean;
}

/** What decides whether the mirror comes back when the app is shown again. */
export interface AvMirrorRestoreConditions {
  /** Starting a stream now would fail, so the restore waits for the device instead. */
  deviceOutOfReach: () => boolean;
  /** Playlist audio has foreground-service / lock-screen controls and can continue while hidden. */
  playlistOwnsBackgroundAudio?: () => boolean;
  /** A tune rendering on the phone owns the speaker, and the C64's audio starting would stop it. */
  phoneIsPlaying: () => boolean;
  restoreWhenDeviceReturns: (state: AvMirrorSuspendedState) => void;
}

const RESTORE_ALWAYS: AvMirrorRestoreConditions = {
  deviceOutOfReach: () => false,
  phoneIsPlaying: () => false,
  restoreWhenDeviceReturns: () => undefined,
};

/**
 * HARD27-021: Live View had no lifecycle policy. Hiding the app left the native receiver running,
 * the phone playing the C64's audio with no notification and no control, and the Ultimate
 * multicasting 2.6 MB/s of video onto the Wi-Fi. If the OS then killed the process the device was
 * never told to stop.
 *
 * Standalone Live View stops on hide and restores on show. Both playlist playback already has a
 * foreground service and lock-screen controls, so its audio continues; video still stops. Audio
 * retained for the playlist is never held for restoration, so Stop while hidden cannot resurrect it.
 */
export class AvMirrorBackgroundPolicy {
  private suspended: AvMirrorSuspendedState | null = null;
  private audioKeptForPlayback = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly session: Pick<
      AvMirrorSession,
      "audioLive" | "videoLive" | "stopAll" | "stopVideo" | "startAudio" | "startVideo"
    >,
    private readonly conditions: AvMirrorRestoreConditions = RESTORE_ALWAYS,
  ) {}

  /** What is being held for restore, or `null` when the mirror was not live when the app was hidden. */
  get suspendedState(): AvMirrorSuspendedState | null {
    return this.suspended;
  }

  /**
   * Run `op` after any transition already in flight. Observed on the Pixel 4: returning to the app
   * can deliver a second hidden/visible pair while the restore is still running its two starts. Left
   * unserialised, the hidden arrives between them, records only the half that is live again, stops
   * both, and the tail of the restore then starts the other half — so the user comes back to audio
   * with no picture. Serialising means the hidden runs after the restore, sees both streams live and
   * records both.
   */
  private serialize(op: () => Promise<void>): Promise<void> {
    const run = this.chain.then(op, op);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  handleHidden(): Promise<void> {
    return this.serialize(() => this.stopForHidden());
  }

  handleVisible(): Promise<void> {
    return this.serialize(() => this.restoreForVisible());
  }

  /**
   * Playback started or stopped while the app is hidden. Audio kept running for the playlist has no
   * owner once the playlist stops, and the phone stops receiving it soon after its foreground service
   * ends, so the Ultimate would go on multicasting it with nobody listening.
   */
  handlePlaybackChanged(): Promise<void> {
    return this.serialize(() => this.releaseAudioNoLongerOwned());
  }

  private async releaseAudioNoLongerOwned(): Promise<void> {
    if (!this.audioKeptForPlayback || this.conditions.playlistOwnsBackgroundAudio?.()) return;
    this.audioKeptForPlayback = false;
    if (!this.session.audioLive) return;
    addLog("info", "Live View: stopping the playlist's audio after playback ended while hidden", {
      service: "streams",
    });
    await this.session.stopAll();
  }

  private async stopForHidden(): Promise<void> {
    if (this.suspended) return;
    const keepAudio = this.session.audioLive && !!this.conditions.playlistOwnsBackgroundAudio?.();
    this.audioKeptForPlayback = keepAudio;
    const state: AvMirrorSuspendedState = {
      audioWasLive: this.session.audioLive && !keepAudio,
      videoWasLive: this.session.videoLive,
    };
    if (!state.audioWasLive && !state.videoWasLive) return;
    this.suspended = state;
    addLog("info", "Live View: stopping the mirror while the app is hidden", {
      service: "streams",
      audioWasLive: state.audioWasLive,
      audioKeptForPlayback: keepAudio,
      videoWasLive: state.videoWasLive,
    });
    if (keepAudio) await this.session.stopVideo();
    else await this.session.stopAll();
  }

  private async restoreForVisible(): Promise<void> {
    this.audioKeptForPlayback = false;
    const state = this.suspended;
    if (!state) return;
    this.suspended = null;
    // Shown again away from the device: a start fails, and the streams come back with the device.
    if (this.conditions.deviceOutOfReach()) {
      addLog("info", "Live View: staying off until the device is back", { service: "streams", ...state });
      this.conditions.restoreWhenDeviceReturns(state);
      return;
    }
    // Only restart what is still stopped. A device retarget, or the user reaching the controls
    // first, can have restarted a stream already, and a second start would open it twice.
    if (state.videoWasLive && !this.session.videoLive) {
      await this.session.startVideo().catch((error: unknown) => {
        addLog("warn", "Live View: failed to restart video after the app became visible", {
          service: "streams",
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      });
    }
    if (state.audioWasLive && !this.session.audioLive && !this.conditions.phoneIsPlaying()) {
      await this.session.startAudio().catch((error: unknown) => {
        addLog("warn", "Live View: failed to restart audio after the app became visible", {
          service: "streams",
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
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
  policy: AvMirrorBackgroundPolicy = new AvMirrorBackgroundPolicy(avMirrorSession, {
    deviceOutOfReach: () => isNetworkKnownOffline() || getConnectionSnapshot().state === "OFFLINE_NO_DEMO",
    phoneIsPlaying: isLocalPlaybackActive,
    playlistOwnsBackgroundAudio: () =>
      isRemotePlaybackActive() &&
      loadMirrorC64Audio() &&
      getMachineExecutionSnapshot().state === "running" &&
      isBackgroundExecutionActive(),
    restoreWhenDeviceReturns: restoreMirrorWhenDeviceReturns,
  }),
): () => void {
  const handleVisibilityChange = () => {
    void (document.hidden ? policy.handleHidden() : policy.handleVisible()).catch((error: unknown) => {
      addLog("error", "Live View: visibility transition failed", {
        service: "streams",
        hidden: document.hidden,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  };
  const handlePlaybackChanged = () => {
    if (!document.hidden) return;
    void policy.handlePlaybackChanged().catch((error: unknown) => {
      addLog("error", "Live View: releasing hidden playlist audio failed", {
        service: "streams",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  const unsubscribePlayback = subscribePlaybackActivity(handlePlaybackChanged);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    unsubscribePlayback();
  };
}
