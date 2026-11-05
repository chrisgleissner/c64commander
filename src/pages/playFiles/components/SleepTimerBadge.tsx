/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { requestSectionOpen } from "@/lib/ui/collapsibleSectionStore";
import { remainingMs, type SleepTimerMode } from "@/lib/playback/sleepTimer";

/** The Play page card that holds the sleep timer's own controls. */
export const SLEEP_TIMER_SECTION = { scope: "play", id: "playback-settings" } as const;

const RING_RADIUS = 9;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * What the badge shows: whole minutes left, rounded up, and how much of the timer is left as a fraction.
 *
 * Both are derived from the same rounded minute, so the ring and the label change together once a minute
 * rather than the ring creeping every second. Null when no timer is armed.
 */
export const sleepTimerBadgeView = (
  mode: SleepTimerMode,
  nowMs: number,
): { label: string; spoken: string; fraction: number } | null => {
  if (mode.kind === "off") return null;
  if (mode.kind === "after-tune") {
    return { label: "Tune", spoken: "Sleep timer: stops after this tune", fraction: 1 };
  }
  const minutesLeft = Math.max(1, Math.ceil((remainingMs(mode, nowMs) ?? 0) / 60_000));
  return {
    label: `${minutesLeft}m`,
    spoken: `Sleep timer: ${minutesLeft} ${minutesLeft === 1 ? "minute" : "minutes"} left`,
    fraction: Math.min(1, minutesLeft / Math.max(1, mode.minutes)),
  };
};

/** Open the card holding the sleep timer and bring its controls into view, with the chosen option focused. */
export const revealSleepTimerControls = () => {
  requestSectionOpen(SLEEP_TIMER_SECTION.scope, SLEEP_TIMER_SECTION.id);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const control = document.querySelector<HTMLElement>('[data-testid="sleep-timer"]');
      control?.scrollIntoView({ block: "center" });
      control?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }),
  );
};

export const SleepTimerBadge = ({ mode, nowMs }: { mode: SleepTimerMode; nowMs: number }) => {
  const view = sleepTimerBadgeView(mode, nowMs);
  if (!view) return null;
  return (
    <button
      type="button"
      className="flex min-h-11 min-w-11 shrink-0 items-center gap-1 rounded-md px-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${view.spoken}. Open the sleep timer`}
      data-testid="app-bar-sleep-timer"
      onClick={revealSleepTimerControls}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r={RING_RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={3} />
        <circle
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - view.fraction)}
          data-testid="app-bar-sleep-timer-ring"
        />
      </svg>
      <span className="text-xs font-medium tabular-nums" data-testid="app-bar-sleep-timer-label">
        {view.label}
      </span>
    </button>
  );
};
