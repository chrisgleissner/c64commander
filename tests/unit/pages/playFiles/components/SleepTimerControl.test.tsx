/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SleepTimerControl } from "@/pages/playFiles/components/SleepTimerControl";
import { SLEEP_TIMER_OFF, type SleepTimerMode } from "@/lib/playback/sleepTimer";

afterEach(() => {
  vi.useRealTimers();
});

describe("SleepTimerControl", () => {
  it("dates a timed choice from the tap, not from the last render", () => {
    // Found on the device: `nowMs` only advances while a timed sleep timer is already running, so
    // when nothing is armed it stands still at whenever the page last ticked — which is precisely
    // the state the control is in when somebody arms one. Computing the end time from it produced
    // a "15m" timer showing 3:33 left.
    const staleNowMs = 1_700_000_000_000;
    const realNowMs = staleNowMs + 11.5 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(realNowMs);

    const onChange = vi.fn();
    render(<SleepTimerControl mode={SLEEP_TIMER_OFF} onChange={onChange} nowMs={staleNowMs} isPlaying />);
    fireEvent.click(screen.getByTestId("sleep-timer-m15"));

    const armed = onChange.mock.calls[0]?.[0] as Extract<SleepTimerMode, { kind: "timed" }>;
    expect(armed.kind).toBe("timed");
    expect(armed.minutes).toBe(15);
    // A full fifteen minutes from now, not fifteen minutes from a stale clock.
    expect(armed.endsAtMs - realNowMs).toBe(15 * 60_000);
  });

  it("offers off and after-this-tune alongside the timed choices", () => {
    const onChange = vi.fn();
    render(<SleepTimerControl mode={SLEEP_TIMER_OFF} onChange={onChange} nowMs={0} isPlaying />);

    fireEvent.click(screen.getByTestId("sleep-timer-after-tune"));
    expect(onChange).toHaveBeenCalledWith({ kind: "after-tune" });

    fireEvent.click(screen.getByTestId("sleep-timer-off"));
    expect(onChange).toHaveBeenLastCalledWith(SLEEP_TIMER_OFF);
  });

  it("always states what it is going to do", () => {
    // Playback stopping on its own is otherwise indistinguishable from playback breaking.
    const nowMs = 1_700_000_000_000;
    const { rerender } = render(
      <SleepTimerControl mode={SLEEP_TIMER_OFF} onChange={vi.fn()} nowMs={nowMs} isPlaying />,
    );
    expect(screen.getByTestId("sleep-timer-state")).toHaveTextContent("Off");

    rerender(<SleepTimerControl mode={{ kind: "after-tune" }} onChange={vi.fn()} nowMs={nowMs} isPlaying />);
    expect(screen.getByTestId("sleep-timer-state")).toHaveTextContent("After this tune");

    rerender(
      <SleepTimerControl
        mode={{ kind: "timed", minutes: 30, endsAtMs: nowMs + 29 * 60_000 }}
        onChange={vi.fn()}
        nowMs={nowMs}
        isPlaying
      />,
    );
    expect(screen.getByTestId("sleep-timer-state")).toHaveTextContent("29:00 left");
  });

  it("marks the armed choice, and only that one", () => {
    render(
      <SleepTimerControl
        mode={{ kind: "timed", minutes: 30, endsAtMs: 60_000 }}
        onChange={vi.fn()}
        nowMs={0}
        isPlaying
      />,
    );
    expect(screen.getByTestId("sleep-timer-m30")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sleep-timer-m15")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("sleep-timer-off")).toHaveAttribute("aria-pressed", "false");
  });
});

describe("SleepTimerControl with nothing playing", () => {
  it("does not offer to stop after a tune when there is no tune", () => {
    // On the device this was tappable, went nowhere and gave no reason: the timer clears itself
    // when nothing is playing rather than lying in wait for whatever is started next.
    const onChange = vi.fn();
    render(<SleepTimerControl mode={SLEEP_TIMER_OFF} onChange={onChange} nowMs={0} isPlaying={false} />);
    const button = screen.getByTestId("sleep-timer-after-tune");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Nothing is playing");
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still offers the timed choices, which do not need anything to be playing", () => {
    render(<SleepTimerControl mode={SLEEP_TIMER_OFF} onChange={vi.fn()} nowMs={0} isPlaying={false} />);
    expect(screen.getByTestId("sleep-timer-m30")).not.toBeDisabled();
    expect(screen.getByTestId("sleep-timer-off")).not.toBeDisabled();
  });
});
