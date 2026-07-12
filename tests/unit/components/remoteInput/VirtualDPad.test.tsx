/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualDPad } from "@/components/remoteInput/VirtualDPad";
import { EMPTY_HELD_JOYSTICK_INPUTS } from "@/lib/remoteInput/joystickHeldSet";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";

const onHeldInputsChangeMock = vi.fn();

// A stateful wrapper mirroring the real parent: onHeldInputsChange feeds back
// into heldInputs, so multi-touch sequences accumulate as they do in production.
const StatefulDPad = ({ spy }: { spy: (next: HeldJoystickInputs) => void }) => {
  const [held, setHeld] = useState<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  return (
    <VirtualDPad
      heldInputs={held}
      onHeldInputsChange={(next) => {
        spy(next);
        setHeld(next);
      }}
    />
  );
};

describe("VirtualDPad", () => {
  beforeEach(() => {
    onHeldInputsChangeMock.mockClear();
  });

  it("holds a single direction while its button is pressed and releases it on pointer up", () => {
    render(<VirtualDPad heldInputs={EMPTY_HELD_JOYSTICK_INPUTS} onHeldInputsChange={onHeldInputsChangeMock} />);

    fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-up"));
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["up"]));

    fireEvent.pointerUp(screen.getByTestId("remote-input-dpad-up"));
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("holds both directions of a diagonal cell together", () => {
    render(<VirtualDPad heldInputs={EMPTY_HELD_JOYSTICK_INPUTS} onHeldInputsChange={onHeldInputsChangeMock} />);

    fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-up-right"));

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["up", "right"]));
  });

  it("releases on pointercancel too (dropped event safety, matching the fire button)", () => {
    render(<VirtualDPad heldInputs={EMPTY_HELD_JOYSTICK_INPUTS} onHeldInputsChange={onHeldInputsChangeMock} />);

    fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-left"));
    fireEvent.pointerCancel(screen.getByTestId("remote-input-dpad-left"));

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  it("composes with a direction already held via another input method without clobbering it", () => {
    render(<VirtualDPad heldInputs={new Set(["fire"]) as never} onHeldInputsChange={onHeldInputsChangeMock} />);

    fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-down"));

    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set(["fire", "down"]));
  });

  it("does not respond to presses while disabled", () => {
    render(
      <VirtualDPad heldInputs={EMPTY_HELD_JOYSTICK_INPUTS} onHeldInputsChange={onHeldInputsChangeMock} disabled />,
    );

    expect(screen.getByTestId("remote-input-dpad-up")).toBeDisabled();
  });

  // Lead F2: mouse (unlike touch) gets no implicit pointer capture on press -
  // without it, dragging off a cell before releasing leaves it stuck held.
  it("captures the pointer on press so a drag-off before release still releases correctly", () => {
    render(<VirtualDPad heldInputs={EMPTY_HELD_JOYSTICK_INPUTS} onHeldInputsChange={onHeldInputsChangeMock} />);
    const cell = screen.getByTestId("remote-input-dpad-up");
    const setPointerCaptureMock = vi.fn();
    cell.setPointerCapture = setPointerCaptureMock;

    fireEvent.pointerDown(cell, { pointerId: 7 });

    expect(setPointerCaptureMock).toHaveBeenCalledWith(7);
  });

  it("HARD19-003: a second cell's release keeps a direction the first finger still holds", () => {
    const spy = vi.fn();
    render(<StatefulDPad spy={spy} />);

    // Finger 1 holds "up".
    fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-up"), { pointerId: 1 });
    expect(spy).toHaveBeenLastCalledWith(new Set(["up"]));

    // Finger 2 grazes the "up-right" cell...
    fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-up-right"), { pointerId: 2 });
    expect(spy).toHaveBeenLastCalledWith(new Set(["up", "right"]));

    // ...and lifts. "up" must survive because finger 1 still holds the up cell;
    // only the diagonal's own "right" contribution is released.
    fireEvent.pointerUp(screen.getByTestId("remote-input-dpad-up-right"), { pointerId: 2 });
    expect(spy).toHaveBeenLastCalledWith(new Set(["up"]));
  });

  it("HARD19-003: an unmatched cell release (slid-on pointer, no prior press) frees nothing", () => {
    const spy = vi.fn();
    render(<StatefulDPad spy={spy} />);

    fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-up"), { pointerId: 1 });
    expect(spy).toHaveBeenLastCalledWith(new Set(["up"]));

    // A pointer slides onto the "up-left" cell and releases with no matching
    // pointerdown on it — this must not delete the "up" the up cell holds.
    fireEvent.pointerUp(screen.getByTestId("remote-input-dpad-up-left"), { pointerId: 2 });
    expect(spy).toHaveBeenLastCalledWith(new Set(["up"]));
  });

  it("marks a cell pressed only when every one of its directions is held", () => {
    render(<VirtualDPad heldInputs={new Set(["up"]) as never} onHeldInputsChange={onHeldInputsChangeMock} />);

    expect(screen.getByTestId("remote-input-dpad-up")).toHaveAttribute("data-pressed", "true");
    expect(screen.getByTestId("remote-input-dpad-up-right")).toHaveAttribute("data-pressed", "false");
  });
});
