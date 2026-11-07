/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const AUDIO_PACKETS_PER_SECOND = 250;

export interface AudioLossGuardConfig {
  /** Length of one measuring window (ms). */
  windowMs: number;
  /** Fraction of the audio packets lost in a window (0-1) at or above which the window counts as bad. */
  lossFraction: number;
  /** Bad windows in a row before the guard trips, so one clump of lost packets does not. */
  consecutiveWindows: number;
  /**
   * Loss fraction at or above which a window counts as the audio being absent rather than squeezed.
   * Another phone that asked the Ultimate for the stream, or a stopped stream, loses every packet;
   * stopping the video cannot bring that audio back, and stopping it on a shared Ultimate stops it
   * for the other phone too.
   */
  absentFraction: number;
}

export const DEFAULT_AUDIO_LOSS_GUARD: AudioLossGuardConfig = {
  windowMs: 1000,
  lossFraction: 0.08,
  consecutiveWindows: 2,
  absentFraction: 0.9,
};

/**
 * Notices a Wi-Fi link that cannot carry the audio and the video stream together.
 *
 * Both streams are multicast, which the access point sends once at its basic rate with no
 * acknowledgement and no retry, and the video is about fourteen times the audio's volume. Measured on
 * one phone and one access point: at 5 GHz the radio received the full 3,600 packets per second and
 * 23 Mbit/s of both streams; at 2.4 GHz it received 585 packets per second and 3 Mbit/s, although the
 * same radio took 3,130 packets per second and 20 Mbit/s sent as unicast. The audio then lost 17% of
 * its packets and was concealed and audibly damaged, and with the video stopped it lost none. Presenting fewer frames does not help, because every
 * video packet is still received. Only stopping the video stream lifts the load.
 *
 * Pure and deterministic: the clock and the cumulative lost-packet counter are passed to {@link update}.
 */
export class AudioLossGuard {
  private readonly config: AudioLossGuardConfig;
  private windowStartMs: number | null = null;
  private windowStartLost = 0;
  private badWindows = 0;

  constructor(config: AudioLossGuardConfig = DEFAULT_AUDIO_LOSS_GUARD) {
    this.config = config;
  }

  /**
   * Feed the cumulative audio packets lost at `nowMs`. `watching` is true while audio and video both
   * stream. Returns the loss fraction of the window that tripped the guard, or null.
   */
  update(nowMs: number, lostPackets: number, watching: boolean): number | null {
    if (!watching) {
      this.reset();
      return null;
    }
    if (this.windowStartMs === null || lostPackets < this.windowStartLost) {
      this.startWindow(nowMs, lostPackets);
      return null;
    }
    const elapsedMs = nowMs - this.windowStartMs;
    if (elapsedMs < this.config.windowMs) return null;

    const expected = (AUDIO_PACKETS_PER_SECOND * elapsedMs) / 1000;
    const fraction = (lostPackets - this.windowStartLost) / expected;
    this.startWindow(nowMs, lostPackets);
    const squeezed = fraction >= this.config.lossFraction && fraction < this.config.absentFraction;
    this.badWindows = squeezed ? this.badWindows + 1 : 0;
    if (this.badWindows < this.config.consecutiveWindows) return null;
    this.badWindows = 0;
    return Math.min(1, fraction);
  }

  reset(): void {
    this.windowStartMs = null;
    this.windowStartLost = 0;
    this.badWindows = 0;
  }

  private startWindow(nowMs: number, lostPackets: number): void {
    this.windowStartMs = nowMs;
    this.windowStartLost = lostPackets;
  }
}
