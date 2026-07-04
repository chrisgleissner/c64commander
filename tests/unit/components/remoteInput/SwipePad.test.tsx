/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { SwipePad } from "@/components/remoteInput/SwipePad";
import { EMPTY_HELD_JOYSTICK_INPUTS } from "@/lib/remoteInput/joystickHeldSet";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";

const onHeldInputsChangeMock = vi.fn();

const LivingSwipePad = ({ initialHeld = EMPTY_HELD_JOYSTICK_INPUTS }: { initialHeld?: HeldJoystickInputs }) => {
  const [heldInputs, setHeldInputs] = useState<HeldJoystickInputs>(initialHeld);
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

const down = (pad: HTMLElement, at: { x: number; y: number }) =>
  fireEvent.pointerDown(pad, { pointerId: 1, clientX: at.x, clientY: at.y });
const move = (pad: HTMLElement, to: { x: number; y: number }) =>
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: to.x, clientY: to.y });
const up = (pad: HTMLElement) => fireEvent.pointerUp(pad, { pointerId: 1 });

describe("SwipePad (live drag)", () => {
  beforeEach(() => onHeldInputsChangeMock.mockClear());

  it("updates the joystick direction live during the drag, before the finger is lifted", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    down(pad, { x: 100, y: 100 });
    move(pad, { x: 170, y: 100 }); // drag right

    // Direction is applied on move, not deferred until pointer-up.
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["right"]));
  });

  it("follows the drawn path, switching direction as the pointer moves", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    down(pad, { x: 100, y: 100 });
    move(pad, { x: 170, y: 100 }); // right
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["right"]));
    move(pad, { x: 100, y: 170 }); // down
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["down"]));
    move(pad, { x: 170, y: 170 }); // down + right
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["down", "right"]));
  });

  it("releases immediately on pointer up (a sustained hold, not a fixed-duration tap)", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    down(pad, { x: 100, y: 100 });
    move(pad, { x: 100, y: 30 }); // up
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["up"]));

    up(pad);
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("releases on pointer cancel", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    down(pad, { x: 100, y: 100 });
    move(pad, { x: 30, y: 100 }); // left
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["left"]));

    fireEvent.pointerCancel(pad, { pointerId: 1 });
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("does not clobber a direction already held via another input method", () => {
    render(<LivingSwipePad initialHeld={new Set(["fire"]) as HeldJoystickInputs} />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    down(pad, { x: 100, y: 100 });
    move(pad, { x: 170, y: 100 }); // right

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["fire", "right"]));
  });

  it("emits nothing on a stationary press+release (no drag, no direction)", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    down(pad, { x: 100, y: 100 });
    up(pad); // never moved

    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });

  it("handles a rapid burst of drags without ever leaving a direction stuck held", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    for (let i = 0; i < 10; i += 1) {
      down(pad, { x: 100, y: 100 });
      move(pad, { x: 170, y: 100 });
      up(pad);
    }

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("shows a drag indicator only while dragging", () => {
    render(<LivingSwipePad />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    expect(pad).toHaveAttribute("data-dragging", "false");
    expect(screen.queryByTestId("remote-input-swipe-dot")).toBeNull();

    down(pad, { x: 100, y: 100 });
    expect(pad).toHaveAttribute("data-dragging", "true");
    expect(screen.getByTestId("remote-input-swipe-dot")).toBeInTheDocument();

    up(pad);
    expect(pad).toHaveAttribute("data-dragging", "false");
    expect(screen.queryByTestId("remote-input-swipe-dot")).toBeNull();
  });

  it("does not respond while disabled", () => {
    render(<SwipePad heldInputs={EMPTY_HELD_JOYSTICK_INPUTS} onHeldInputsChange={onHeldInputsChangeMock} disabled />);
    const pad = screen.getByTestId("remote-input-swipe-pad");

    down(pad, { x: 100, y: 100 });
    move(pad, { x: 170, y: 100 });
    up(pad);

    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });
});
