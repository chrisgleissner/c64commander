/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualDPad } from "@/components/remoteInput/VirtualDPad";
import { EMPTY_HELD_JOYSTICK_INPUTS } from "@/lib/remoteInput/joystickHeldSet";

const onHeldInputsChangeMock = vi.fn();

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

  it("marks a cell pressed only when every one of its directions is held", () => {
    render(<VirtualDPad heldInputs={new Set(["up"]) as never} onHeldInputsChange={onHeldInputsChangeMock} />);

    expect(screen.getByTestId("remote-input-dpad-up")).toHaveAttribute("data-pressed", "true");
    expect(screen.getByTestId("remote-input-dpad-up-right")).toHaveAttribute("data-pressed", "false");
  });
});
