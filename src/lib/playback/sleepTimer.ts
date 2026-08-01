/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Stopping playback later, without having to be awake for it.
 *
 * A station is endless by design, which is the point of it and also the problem: the obvious way to
 * listen to SID music is in bed, and the obvious way to stop is to still be conscious when you want
 * to. The two settings people actually reach for are "finish this one and stop" and "give it about
 * half an hour", so those are the two kinds offered and there is no third.
 *
 * Kept as a pure model because the interesting parts — when it should fire, what it should say —
 * are decisions about time, and a timer that is only ever exercised by waiting for it is a timer
 * that is not really tested.
 */

export type SleepTimerMode =
  | { kind: "off" }
  /** Stop when the tune playing now ends, rather than at a wall-clock time. */
  | { kind: "after-tune" }
  /** Stop at `endsAtMs`, mid-tune if that is where the time lands. */
  | { kind: "timed"; endsAtMs: number; minutes: number };

export const SLEEP_TIMER_OFF: SleepTimerMode = { kind: "off" };

/** The choices offered, in minutes. Beyond an hour a sleep timer is doing nothing a person needs. */
export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60] as const;

export const armTimed = (minutes: number, nowMs: number): SleepTimerMode => ({
  kind: "timed",
  minutes,
  endsAtMs: nowMs + minutes * 60_000,
});

/** Whether a timed sleep timer has run out. Never true for the other kinds, which are event-driven. */
export const hasElapsed = (mode: SleepTimerMode, nowMs: number): boolean =>
  mode.kind === "timed" && nowMs >= mode.endsAtMs;

export const remainingMs = (mode: SleepTimerMode, nowMs: number): number | null =>
  mode.kind === "timed" ? Math.max(0, mode.endsAtMs - nowMs) : null;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The countdown, as `h:mm:ss` or `m:ss`.
 *
 * Rounded up, not down, so a timer with 800 ms left reads "0:01" rather than "0:00" while the music
 * is still playing — a countdown that sits on zero for a second looks stuck.
 */
export const formatRemaining = (ms: number): string => {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
};

/**
 * What the control says about itself.
 *
 * An armed sleep timer that shows nothing is how somebody ends up believing their app stopped
 * playing on its own, so the state is always stated rather than implied by a highlighted icon.
 */
export const describeSleepTimer = (mode: SleepTimerMode, nowMs: number): string => {
  if (mode.kind === "off") return "Off";
  if (mode.kind === "after-tune") return "After this tune";
  return `${formatRemaining(remainingMs(mode, nowMs) ?? 0)} left`;
};

/** Whether playback should stop now that the current tune has ended. */
export const shouldStopAfterTune = (mode: SleepTimerMode): boolean => mode.kind === "after-tune";
