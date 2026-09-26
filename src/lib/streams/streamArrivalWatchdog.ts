/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** How long a live mirror may receive nothing before it is treated as no longer live. */
export const STREAM_ARRIVAL_TIMEOUT_MS = 8000;

/** How long a new stream may stay silent before the controllers look for a refused sender. */
const QUIET_START_MS = 1500;

/** How often the watchdog looks at the clock. */
const CHECK_INTERVAL_MS = 1000;

export interface StreamArrivalWatchdogOptions {
  /** Called once, from the watchdog's own timer, when nothing has arrived for `timeoutMs`. */
  onStale: (silentMs: number) => void;
  /**
   * An extra arrival source, polled on each check. Returning true counts as an arrival.
   *
   * The native audio path plays datagrams inside the plugin and stops handing them to JS, so there
   * is nothing to stamp per packet; the plugin's own socket-level packet counter is the only signal
   * left, and it has to be read rather than pushed.
   */
  pollArrival?: () => boolean;
  /**
   * Called once when nothing has arrived by `quietStartMs` after start. A dual-homed Ultimate streams
   * from its other address, and finding that out early saves the user the full timeout of silence.
   */
  onQuietStart?: () => void;
  quietStartMs?: number;
  timeoutMs?: number;
  checkIntervalMs?: number;
  now?: () => number;
}

/**
 * Notices that a live mirror has stopped receiving.
 *
 * A bound multicast socket reports nothing when the packets simply stop: the Wi-Fi goes away, the
 * device reboots, or another AP drops the group, and the socket stays open with no error and no
 * close. Both mirror controllers derive their state from the receiver's connection events alone, so
 * once either reached `live` it stayed `live` for as long as the page was open — measured at over
 * three minutes with the phone's Wi-Fi switched off, with the card still reading "Watching".
 *
 * The watchdog is armed when a mirror goes live and disarmed when it stops, and each arriving frame
 * or datagram stamps it.
 *
 * **A starved timer is not silence.** A hidden WebView suspends `setInterval` almost entirely, so
 * returning to the foreground would otherwise look like one long gap and fire immediately. Each
 * check therefore also measures how long since the *previous check*: when the timer itself was not
 * running, the watchdog re-stamps and waits rather than reporting a fault it did not observe.
 */
export class StreamArrivalWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastArrivalMs = 0;
  private lastCheckMs = 0;
  private startedMs = 0;
  private arrivedSinceStart = false;
  private quietStartReported = false;
  private readonly timeoutMs: number;
  private readonly checkIntervalMs: number;
  private readonly now: () => number;

  constructor(private readonly options: StreamArrivalWatchdogOptions) {
    this.timeoutMs = options.timeoutMs ?? STREAM_ARRIVAL_TIMEOUT_MS;
    this.checkIntervalMs = options.checkIntervalMs ?? CHECK_INTERVAL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Arm the watchdog, treating this moment as the last arrival. */
  start(): void {
    this.stop();
    this.lastArrivalMs = this.now();
    this.lastCheckMs = this.lastArrivalMs;
    this.startedMs = this.lastArrivalMs;
    this.arrivedSinceStart = false;
    this.quietStartReported = false;
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
  }

  /** Record that something arrived. Cheap enough for the per-datagram path. */
  noteArrival(): void {
    this.lastArrivalMs = this.now();
    this.arrivedSinceStart = true;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** True while armed — the controllers use it to avoid re-arming an already-running watchdog. */
  get running(): boolean {
    return this.timer !== null;
  }

  private check(): void {
    const now = this.now();
    const sinceCheck = now - this.lastCheckMs;
    this.lastCheckMs = now;
    // The timer did not run for a whole timeout window, so this process was not watching. Whatever
    // happened in that gap was not observed and must not be reported as silence.
    if (sinceCheck >= this.timeoutMs) {
      this.lastArrivalMs = now;
      return;
    }
    if (this.options.pollArrival?.()) {
      this.lastArrivalMs = now;
      this.arrivedSinceStart = true;
    }
    this.reportQuietStart(now);
    const silentMs = now - this.lastArrivalMs;
    if (silentMs < this.timeoutMs) return;
    this.stop();
    this.options.onStale(silentMs);
  }

  private reportQuietStart(now: number): void {
    const quietStartMs = this.options.quietStartMs ?? QUIET_START_MS;
    if (this.arrivedSinceStart || this.quietStartReported || now - this.startedMs < quietStartMs) return;
    this.quietStartReported = true;
    this.options.onQuietStart?.();
  }
}
