/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

/** Delays before each automatic restart of a lost video stream; its length is the bound on attempts. */
export const VIDEO_RECOVERY_BACKOFF_MS: readonly number[] = [2000, 6000];

/** How long a restarted stream must stay live before its attempts are counted afresh. */
export const VIDEO_RECOVERY_STABLE_MS = 30000;

/**
 * Decides whether a lost video stream is restarted automatically, and after how long.
 *
 * A stream that keeps dying after each restart is not helped by more restarts, so the attempts are
 * bounded and only a stream that then stays live for {@link VIDEO_RECOVERY_STABLE_MS} earns a new set.
 */
export class VideoLossRecovery {
  private attempts = 0;

  /** The delay before the next restart, or null when the attempts for this loss episode are used up. */
  noteLost(liveForMs: number): number | null {
    if (liveForMs >= VIDEO_RECOVERY_STABLE_MS) this.attempts = 0;
    if (this.attempts >= VIDEO_RECOVERY_BACKOFF_MS.length) return null;
    return VIDEO_RECOVERY_BACKOFF_MS[this.attempts++];
  }

  /** A user-initiated start or stop begins a fresh episode. */
  reset(): void {
    this.attempts = 0;
  }
}

export interface VideoLossRestarterHooks {
  /** Watch is still wanted: nobody stopped it since it was started. */
  isWanted: () => boolean;
  /** The video mirror is still in its lost (error) state. */
  isLost: () => boolean;
  /** The Ultimate answers REST, so a restart has something to start. */
  deviceAnswers: () => Promise<boolean>;
  restart: () => Promise<void>;
  /** No restart will follow; the lost state stays as the final answer. */
  giveUp: () => void;
  isPageHidden: () => boolean;
}

/**
 * Restarts a lost video stream after the {@link VideoLossRecovery} backoff.
 *
 * Every wait here ends: the delay is a timer, a hidden page is waited out only until it is shown,
 * and {@link cancel} (called on any stop) clears both.
 */
export class VideoLossRestarter {
  private readonly recovery = new VideoLossRecovery();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onVisible: (() => void) | null = null;

  constructor(private readonly hooks: VideoLossRestarterHooks) {}

  /** `liveForMs` is how long the stream had been live before it went silent. Returns true when a restart is scheduled. */
  onLost(liveForMs: number): boolean {
    if (!this.hooks.isWanted()) return false;
    const delayMs = this.recovery.noteLost(liveForMs);
    if (delayMs === null) return false;
    this.clearWaits();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attempt();
    }, delayMs);
    return true;
  }

  /** A stop or a user-initiated start: no restart is pending and the next loss starts a fresh episode. */
  cancel(): void {
    this.clearWaits();
    this.recovery.reset();
  }

  private clearWaits(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.onVisible) document.removeEventListener("visibilitychange", this.onVisible);
    this.onVisible = null;
  }

  private async attempt(): Promise<void> {
    if (!this.hooks.isWanted() || !this.hooks.isLost()) return;
    if (this.hooks.isPageHidden()) {
      this.onVisible = () => {
        this.clearWaits();
        void this.attempt();
      };
      document.addEventListener("visibilitychange", this.onVisible, { once: true });
      return;
    }
    try {
      if (!(await this.hooks.deviceAnswers())) {
        addLog("warn", "Live View: not restarting the lost video because the device does not answer REST", {
          service: "streams",
        });
        this.hooks.giveUp();
        return;
      }
      if (!this.hooks.isWanted() || !this.hooks.isLost()) return;
      addLog("info", "Live View: restarting the lost video stream", { service: "streams" });
      await this.hooks.restart();
    } catch (error) {
      addLog("warn", "Live View: restarting the lost video stream failed", {
        service: "streams",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.hooks.giveUp();
    }
  }
}
