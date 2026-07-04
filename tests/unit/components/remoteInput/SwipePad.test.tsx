/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SwipePad } from "@/components/remoteInput/SwipePad";
import { EMPTY_HELD_JOYSTICK_INPUTS } from "@/lib/remoteInput/joystickHeldSet";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";
import { SWIPE_TAP_HOLD_MS } from "@/lib/remoteInput/swipeGesture";

const onHeldInputsChangeMock = vi.fn();

const LivingSwipePad = () => {
  const [heldInputs, setHeldInputs] = useState<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  return (
    <SwipePad
      heldInputs={heldInputs}
      onHeldInputsChange={(next) => {
        setHeldInputs(next);
        onHeldInputsChangeMock(next);
      }}
    />
  );
};

const swipe = (pad: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) => {
  fireEvent.pointerDown(pad, { pointerId: 1, clientX: from.x, clientY: from.y });
  fireEvent.pointerUp(pad, { pointerId: 1, clientX: to.x, clientY: to.y });
};

describe("SwipePad", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onHeldInputsChangeMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers a brief directional tap on a fast rightward swipe, then auto-releases", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    swipe(pad, { x: 100, y: 100 }, { x: 170, y: 100 });

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["right"]));

    vi.advanceTimersByTime(SWIPE_TAP_HOLD_MS + 1);

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("holds the swipe direction for at least SWIPE_TAP_HOLD_MS, longer than the transport's coalescing window", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    swipe(pad, { x: 100, y: 100 }, { x: 100, y: 30 }); // up

    vi.advanceTimersByTime(SWIPE_TAP_HOLD_MS - 10);
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["up"]));

    vi.advanceTimersByTime(20);
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("ignores a short tap (no meaningful displacement)", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    swipe(pad, { x: 100, y: 100 }, { x: 102, y: 101 });

    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });

  it("does not clobber a direction already held via another input method", () => {
    const heldInputs = new Set(["fire"]) as HeldJoystickInputs;
    render(<SwipePad heldInputs={heldInputs} onHeldInputsChange={onHeldInputsChangeMock} />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    swipe(pad, { x: 100, y: 100 }, { x: 170, y: 100 });

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["fire", "right"]));
  });

  it("cancels the in-progress gesture on pointercancel without emitting a tap", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerCancel(pad, { pointerId: 1 });
    fireEvent.pointerUp(pad, { pointerId: 1, clientX: 170, clientY: 100 });

    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });

  it("handles a rapid burst of repeated swipes without ever leaving a direction stuck held", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    for (let i = 0; i < 10; i += 1) {
      swipe(pad, { x: 100, y: 100 }, { x: 170, y: 100 });
      vi.advanceTimersByTime(SWIPE_TAP_HOLD_MS + 1);
    }

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("does not respond while disabled", () => {
    render(<SwipePad heldInputs={EMPTY_HELD_JOYSTICK_INPUTS} onHeldInputsChange={onHeldInputsChangeMock} disabled />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    swipe(pad, { x: 100, y: 100 }, { x: 170, y: 100 });

    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });

  // HARD13-003: an input pressed DURING the swipe's ~120ms auto-hold window must
  // survive the auto-release, which previously reset the held set from a stale
  // snapshot taken at swipe time and clobbered it.
  it("preserves an input pressed during the swipe hold window on auto-release", () => {
    const SwipePadWithFireButton = () => {
      const [heldInputs, setHeldInputs] = useState<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
      const change = (next: HeldJoystickInputs) => {
        setHeldInputs(next);
        onHeldInputsChangeMock(next);
      };
      return (
        <>
          <button
            data-testid="press-fire"
            onClick={() => change(new Set([...heldInputs, "fire"]) as HeldJoystickInputs)}
          >
            fire
          </button>
          <SwipePad heldInputs={heldInputs} onHeldInputsChange={change} />
        </>
      );
    };
    render(<SwipePadWithFireButton />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    swipe(pad, { x: 100, y: 100 }, { x: 100, y: 30 }); // up
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["up"]));

    fireEvent.click(screen.getByTestId("press-fire")); // fire pressed mid-hold-window
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["up", "fire"]));

    vi.advanceTimersByTime(SWIPE_TAP_HOLD_MS + 1); // auto-release: drops "up" only, keeps "fire"
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["fire"]));
  });

  // HARD13-003: the pending auto-release timer must be cleared on unmount
  // (movement-style switch / sheet close) so it can't fire against a torn-down
  // session and re-press the swipe direction after the sheet's release-all.
  it("does not fire the auto-release timer after unmount", () => {
    const { unmount } = render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    swipe(pad, { x: 100, y: 100 }, { x: 170, y: 100 }); // right
    expect(onHeldInputsChangeMock).toHaveBeenCalledTimes(1);
    onHeldInputsChangeMock.mockClear();

    unmount();
    vi.advanceTimersByTime(SWIPE_TAP_HOLD_MS + 1);

    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });
});
