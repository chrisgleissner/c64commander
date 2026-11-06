/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";

/** How long after a loss the device is asked whether it answers, before a restart or a verdict. */
export const STREAM_RECOVERY_DELAY_MS = 2000;

/** How long a restarted stream must stay live before a later loss counts as a new episode. */
export const STREAM_RECOVERY_STABLE_MS = 30000;

/** Restart the stream, or leave it to the other client that asked the device for it. */
export type StreamLossStep = "restart" | "yield";

/**
 * Decides what a lost video or audio stream gets.
 *
 * The Ultimate sends each stream to one address. A stream that is lost again soon after this phone
 * restarted it, while the device still answers, has been asked for by another client; restarting
 * it again would take it from that client, whose recovery would take it back in turn. So only the
 * first loss in an episode is restarted, and an episode ends when a stream stays live for
 * {@link STREAM_RECOVERY_STABLE_MS}.
 */
export class StreamLossRecovery {
  private restarted = false;

  noteLost(liveForMs: number): StreamLossStep {
    if (liveForMs >= STREAM_RECOVERY_STABLE_MS) this.restarted = false;
    if (this.restarted) return "yield";
    this.restarted = true;
    return "restart";
  }

  /** A user-initiated start or stop begins a fresh episode. */
  reset(): void {
    this.restarted = false;
  }
}

export interface StreamLossRestarterHooks {
  /** Which mirror this restarter serves; it names the stream in the log. */
  stream: "video" | "audio";
  /** Watch is still wanted: nobody stopped it since it was started. */
  isWanted: () => boolean;
  /** The mirror is still in its lost (error) state. */
  isLost: () => boolean;
  /** The Ultimate answers REST, so a restart has something to start. */
  deviceAnswers: () => Promise<boolean>;
  restart: () => Promise<void>;
  /** No restart will follow; the lost state stays as the final answer. */
  giveUp: () => void;
  /** The device answers but keeps streaming elsewhere: say that another client has the stream. */
  yieldToOtherClient: () => void;
  isPageHidden: () => boolean;
}

/**
 * Restarts a lost video or audio stream, or leaves it to another client, as {@link StreamLossRecovery} decides.
 *
 * Every wait here ends: the delay is a timer, a hidden page is waited out only until it is shown,
 * and {@link cancel} (called on any stop) clears both.
 */
export class StreamLossRestarter {
  private readonly recovery = new StreamLossRecovery();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onVisible: (() => void) | null = null;

  constructor(private readonly hooks: StreamLossRestarterHooks) {}

  /** `liveForMs` is how long the stream had been live before it went silent. Returns true when a restart is scheduled. */
  onLost(liveForMs: number): boolean {
    if (!this.hooks.isWanted()) return false;
    const step = this.recovery.noteLost(liveForMs);
    this.clearWaits();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attempt(step);
    }, STREAM_RECOVERY_DELAY_MS);
    return step === "restart";
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

  private async attempt(step: StreamLossStep): Promise<void> {
    if (!this.hooks.isWanted() || !this.hooks.isLost()) return;
    if (this.hooks.isPageHidden()) {
      this.onVisible = () => {
        this.clearWaits();
        void this.attempt(step);
      };
      document.addEventListener("visibilitychange", this.onVisible, { once: true });
      return;
    }
    try {
      if (!(await this.hooks.deviceAnswers())) {
        addLog(
          "warn",
          `Live View: not restarting the lost ${this.hooks.stream} because the device does not answer REST`,
          {
            service: "streams",
          },
        );
        this.hooks.giveUp();
        return;
      }
      if (!this.hooks.isWanted() || !this.hooks.isLost()) return;
      if (step === "yield") {
        addLog("info", `Live View: the ${this.hooks.stream} stream was lost again while the device answers`, {
          service: "streams",
        });
        this.hooks.yieldToOtherClient();
        return;
      }
      addLog("info", `Live View: restarting the lost ${this.hooks.stream} stream`, { service: "streams" });
      await this.hooks.restart();
    } catch (error) {
      addLog("warn", `Live View: restarting the lost ${this.hooks.stream} stream failed`, {
        service: "streams",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.hooks.giveUp();
    }
  }
}
