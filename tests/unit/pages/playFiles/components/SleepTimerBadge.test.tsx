/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { armTimed, SLEEP_TIMER_OFF } from "@/lib/playback/sleepTimer";
import { SECTION_OPEN_REQUEST_EVENT } from "@/lib/ui/collapsibleSectionStore";
import { SleepTimerBadge, sleepTimerBadgeView } from "@/pages/playFiles/components/SleepTimerBadge";

const T0 = 5_000_000;

afterEach(() => vi.restoreAllMocks());

describe("sleepTimerBadgeView", () => {
  it("shows whole minutes left, rounded up, and never seconds", () => {
    const mode = armTimed(15, T0);
    expect(sleepTimerBadgeView(mode, T0)?.label).toBe("15m");
    expect(sleepTimerBadgeView(mode, T0 + 1_000)?.label).toBe("15m");
    expect(sleepTimerBadgeView(mode, T0 + 3 * 60_000)?.label).toBe("12m");
    expect(sleepTimerBadgeView(mode, T0 + 3 * 60_000 - 1)?.label).toBe("13m");
    expect(sleepTimerBadgeView(mode, T0 + 15 * 60_000 - 30_000)?.label).toBe("1m");
    expect(sleepTimerBadgeView(mode, T0 + 15 * 60_000)?.label).toBe("1m");
  });

  it("moves the ring with the rounded minute, so it changes no more often than the label", () => {
    const mode = armTimed(30, T0);
    expect(sleepTimerBadgeView(mode, T0)?.fraction).toBe(1);
    expect(sleepTimerBadgeView(mode, T0 + 15 * 60_000)?.fraction).toBe(0.5);
    expect(sleepTimerBadgeView(mode, T0 + 15 * 60_000 - 59_000)?.fraction).toBeCloseTo(16 / 30);
  });

  it("is hidden when no timer is armed and names the tune when stopping after it", () => {
    expect(sleepTimerBadgeView(SLEEP_TIMER_OFF, T0)).toBeNull();
    expect(sleepTimerBadgeView({ kind: "after-tune" }, T0)?.label).toBe("Tune");
  });
});

describe("SleepTimerBadge", () => {
  it("announces a singular minute and the after-tune stop with their visible labels", () => {
    const { rerender } = render(<SleepTimerBadge mode={armTimed(15, T0)} nowMs={T0 + 14 * 60_000} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Sleep timer: 1 minute left. Open the sleep timer");
    expect(screen.getByTestId("app-bar-sleep-timer-label")).toHaveTextContent("1m");
    rerender(<SleepTimerBadge mode={{ kind: "after-tune" }} nowMs={T0} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Sleep timer: stops after this tune. Open the sleep timer");
    expect(screen.getByTestId("app-bar-sleep-timer-label")).toHaveTextContent("Tune");
    expect(screen.getByTestId("app-bar-sleep-timer-ring")).toHaveAttribute("stroke-dashoffset", "0");
  });

  it("renders nothing while the timer is off", () => {
    render(<SleepTimerBadge mode={SLEEP_TIMER_OFF} nowMs={T0} />);
    expect(screen.queryByTestId("app-bar-sleep-timer")).toBeNull();
  });

  it("opens the card holding the sleep timer and focuses the chosen option", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const openRequests: unknown[] = [];
    window.addEventListener(SECTION_OPEN_REQUEST_EVENT, (event) => openRequests.push((event as CustomEvent).detail));
    const control = document.createElement("div");
    control.dataset.testid = "sleep-timer";
    control.scrollIntoView = vi.fn();
    const chosen = document.createElement("button");
    chosen.setAttribute("aria-pressed", "true");
    control.appendChild(chosen);
    document.body.appendChild(control);

    render(<SleepTimerBadge mode={armTimed(30, T0)} nowMs={T0 + 60_000} />);
    const badge = screen.getByTestId("app-bar-sleep-timer");
    expect(badge).toHaveAccessibleName("Sleep timer: 29 minutes left. Open the sleep timer");
    fireEvent.click(badge);

    expect(openRequests).toEqual([expect.objectContaining({ scope: "play", id: "playback-settings" })]);
    expect(control.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(chosen);
    control.remove();
  });
});
