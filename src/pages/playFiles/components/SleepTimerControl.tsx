/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  describeSleepTimer,
  SLEEP_TIMER_MINUTES,
  SLEEP_TIMER_OFF,
  type SleepTimerMode,
} from "@/lib/playback/sleepTimer";

export type SleepTimerControlProps = {
  mode: SleepTimerMode;
  onChange: (mode: SleepTimerMode) => void;
  /** Passed in rather than read here, so the countdown ticks from one clock. */
  nowMs: number;
};

/**
 * When to stop.
 *
 * A row of choices rather than a dropdown: there are six of them, they are all short, and a
 * dropdown would hide the current state behind a tap on the one control whose whole job is to say
 * what it is going to do. "Off" is one of the choices for the same reason — cancelling has to be as
 * plain as setting it.
 */
export const SleepTimerControl = ({ mode, onChange, nowMs }: SleepTimerControlProps) => {
  const armed = mode.kind !== "off";
  const options: Array<{ key: string; label: string; next: SleepTimerMode; active: boolean }> = [
    { key: "off", label: "Off", next: SLEEP_TIMER_OFF, active: mode.kind === "off" },
    {
      key: "after-tune",
      label: "This tune",
      next: { kind: "after-tune" },
      active: mode.kind === "after-tune",
    },
    ...SLEEP_TIMER_MINUTES.map((minutes) => ({
      key: `m${minutes}`,
      label: `${minutes}m`,
      // Armed from the moment it is chosen, so the countdown starts on the tap rather than on some
      // later render.
      next: { kind: "timed" as const, minutes, endsAtMs: nowMs + minutes * 60_000 },
      active: mode.kind === "timed" && mode.minutes === minutes,
    })),
  ];

  return (
    <div className="space-y-2" data-testid="sleep-timer">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">Sleep timer</p>
        {/* Always stated, never implied by a highlighted button alone: playback stopping on its own
            is otherwise indistinguishable from playback breaking. */}
        <p
          className={cn("text-xs tabular-nums", armed ? "font-medium text-foreground" : "text-muted-foreground")}
          data-testid="sleep-timer-state"
        >
          {describeSleepTimer(mode, nowMs)}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sleep timer">
        {options.map((option) => (
          <Button
            key={option.key}
            type="button"
            size="sm"
            variant={option.active ? "default" : "outline"}
            className="h-8 px-2.5 text-xs"
            aria-pressed={option.active}
            data-testid={`sleep-timer-${option.key}`}
            onClick={() => onChange(option.next)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
};
