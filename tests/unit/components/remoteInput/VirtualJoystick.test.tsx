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
import { VirtualJoystick } from "@/components/remoteInput/VirtualJoystick";
import { EMPTY_HELD_JOYSTICK_INPUTS } from "@/lib/remoteInput/joystickHeldSet";
import type { HeldJoystickInputs } from "@/lib/remoteInput/joystickHeldSet";

/**
 * A real controlled wrapper (state actually round-trips through
 * onHeldInputsChange), unlike renderStick's static mock props. Needed for
 * stress tests where the stick and the fire button must compose correctly -
 * a static-prop harness would hide a stale-closure bug where one control
 * overwrites the other's contribution to the held set.
 */
const LivingJoystick = ({ port = 2 }: { port?: 1 | 2 }) => {
  const [heldInputs, setHeldInputs] = useState<HeldJoystickInputs>(EMPTY_HELD_JOYSTICK_INPUTS);
  const [autofireEnabled, setAutofireEnabled] = useState(false);
  return (
    <VirtualJoystick
      port={port}
      onSetPort={setPortMock}
      heldInputs={heldInputs}
      onHeldInputsChange={setHeldInputs}
      autofireEnabled={autofireEnabled}
      onAutofireEnabledChange={setAutofireEnabled}
      autofireRateHz={5}
      onAutofireRateHzChange={() => {}}
    />
  );
};

const setPortMock = vi.fn();
const onHeldInputsChangeMock = vi.fn();
const setAutofireEnabledChangeMock = vi.fn();

const setupZoneGeometry = (zone: HTMLElement) => {
  vi.spyOn(zone, "clientWidth", "get").mockReturnValue(120);
  zone.setPointerCapture = vi.fn();
};

describe("VirtualJoystick", () => {
  beforeEach(() => {
    setPortMock.mockClear();
    onHeldInputsChangeMock.mockClear();
    setAutofireEnabledChangeMock.mockClear();
  });

  const renderStick = (heldInputs: ReadonlySet<string> = EMPTY_HELD_JOYSTICK_INPUTS) =>
    render(
      <VirtualJoystick
        port={2}
        onSetPort={setPortMock}
        heldInputs={heldInputs as never}
        onHeldInputsChange={onHeldInputsChangeMock}
        autofireEnabled={false}
        onAutofireEnabledChange={setAutofireEnabledChangeMock}
        autofireRateHz={5}
        onAutofireRateHzChange={() => {}}
      />,
    );

  it("resolves a drag past the dead zone to a direction and emits the held set", () => {
    renderStick();
    const zone = screen.getByTestId("remote-input-stick-zone");
    setupZoneGeometry(zone);

    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 }); // straight up

    expect(onHeldInputsChangeMock).toHaveBeenCalledWith(new Set(["up"]));
  });

  it("resolves a diagonal drag to a two-direction held set", () => {
    renderStick();
    const zone = screen.getByTestId("remote-input-stick-zone");
    setupZoneGeometry(zone);

    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 140, clientY: 60 }); // up-right

    expect(onHeldInputsChangeMock).toHaveBeenCalledWith(new Set(["right", "up"]));
  });

  it("does not resolve a direction while inside the dead zone", () => {
    renderStick();
    const zone = screen.getByTestId("remote-input-stick-zone");
    setupZoneGeometry(zone);

    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 103, clientY: 100 }); // tiny movement

    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });

  it("releases the direction on pointer up (no stuck stick direction)", () => {
    renderStick();
    const zone = screen.getByTestId("remote-input-stick-zone");
    setupZoneGeometry(zone);

    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 });
    onHeldInputsChangeMock.mockClear();
    fireEvent.pointerUp(zone, { pointerId: 1 });

    expect(onHeldInputsChangeMock).toHaveBeenCalledWith(new Set());
  });

  it("releases the direction on pointer cancel too (missed pointerup safety)", () => {
    renderStick();
    const zone = screen.getByTestId("remote-input-stick-zone");
    setupZoneGeometry(zone);

    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 });
    onHeldInputsChangeMock.mockClear();
    fireEvent.pointerCancel(zone, { pointerId: 1 });

    expect(onHeldInputsChangeMock).toHaveBeenCalledWith(new Set());
  });

  it("holds fire while the fire button is pressed and releases it on pointer up", () => {
    renderStick();
    const fireButton = screen.getByTestId("remote-input-fire-button");

    fireEvent.pointerDown(fireButton);
    expect(onHeldInputsChangeMock).toHaveBeenCalledWith(new Set(["fire"]));

    fireEvent.pointerUp(fireButton);
    expect(onHeldInputsChangeMock).toHaveBeenLastCalledWith(new Set());
  });

  // Lead F2: mouse (unlike touch) gets no implicit pointer capture on press -
  // without it, dragging the mouse off FIRE before releasing leaves it stuck
  // held (no pointerup ever reaches the button).
  it("captures the pointer on press so a drag-off before release still releases correctly", () => {
    renderStick();
    const fireButton = screen.getByTestId("remote-input-fire-button");
    const setPointerCaptureMock = vi.fn();
    fireButton.setPointerCapture = setPointerCaptureMock;

    fireEvent.pointerDown(fireButton, { pointerId: 3 });

    expect(setPointerCaptureMock).toHaveBeenCalledWith(3);
  });

  it("swaps the joystick port with a single tap, just like the autofire toggle", () => {
    renderStick();
    // Default port is 2 (per the session hook), so the switch starts "on".
    fireEvent.click(screen.getByTestId("remote-input-port-switch"));
    expect(setPortMock).toHaveBeenCalledWith(1);
  });

  it("shows the current port as a label next to the swap switch", () => {
    render(
      <VirtualJoystick
        port={1}
        onSetPort={setPortMock}
        heldInputs={EMPTY_HELD_JOYSTICK_INPUTS as never}
        onHeldInputsChange={onHeldInputsChangeMock}
        autofireEnabled={false}
        onAutofireEnabledChange={setAutofireEnabledChangeMock}
        autofireRateHz={5}
        onAutofireRateHzChange={() => {}}
      />,
    );
    expect(screen.getByTestId("remote-input-port-toggle")).toHaveTextContent("Port 1");
  });

  it("toggles autofire", () => {
    renderStick();
    fireEvent.click(screen.getByTestId("remote-input-autofire-switch"));
    expect(setAutofireEnabledChangeMock).toHaveBeenCalledWith(true);
  });

  it("uses the same horizontal switch+label pattern for Autofire as for Port (HARD16-008)", () => {
    renderStick();
    const autofireLabel = screen.getByTestId("remote-input-autofire-switch").closest("label");
    const portLabel = screen.getByTestId("remote-input-port-switch").closest("label");
    // Horizontal row (switch beside label), not the old stacked switch-above-label card.
    expect(autofireLabel?.className).toContain("items-center");
    expect(autofireLabel?.className).not.toContain("flex-col");
    expect(portLabel?.className).toContain("items-center");
    expect(autofireLabel).toHaveTextContent("Autofire");
  });

  it("shows the disabled hint and blocks input when the joystick tier is unavailable", () => {
    render(
      <VirtualJoystick
        port={2}
        onSetPort={setPortMock}
        heldInputs={EMPTY_HELD_JOYSTICK_INPUTS as never}
        onHeldInputsChange={onHeldInputsChangeMock}
        autofireEnabled={false}
        onAutofireEnabledChange={setAutofireEnabledChangeMock}
        autofireRateHz={5}
        onAutofireRateHzChange={() => {}}
        disabled
        disabledHint="Needs newer firmware"
      />,
    );

    expect(screen.getByTestId("remote-input-joystick-unavailable-hint")).toHaveTextContent("Needs newer firmware");
    const zone = screen.getByTestId("remote-input-stick-zone");
    setupZoneGeometry(zone);
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 });
    expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
  });

  describe("edge cases and stress (multi-touch, composition, rapid gestures)", () => {
    it("composes a held stick direction and a held fire press without either overwriting the other", () => {
      render(<LivingJoystick />);
      const zone = screen.getByTestId("remote-input-stick-zone");
      setupZoneGeometry(zone);

      fireEvent.pointerDown(screen.getByTestId("remote-input-fire-button"));
      fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 }); // up

      expect(screen.getByTestId("remote-input-fire-button")).toHaveAttribute("data-pressed", "true");
      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "true");
    });

    it("releasing fire does not clear a simultaneously-held stick direction", () => {
      render(<LivingJoystick />);
      const zone = screen.getByTestId("remote-input-stick-zone");
      setupZoneGeometry(zone);
      const fireButton = screen.getByTestId("remote-input-fire-button");

      fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 }); // up
      fireEvent.pointerDown(fireButton);
      fireEvent.pointerUp(fireButton);

      expect(fireButton).toHaveAttribute("data-pressed", "false");
      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "true");
    });

    it("ignores a second pointer's move while a different pointer is already dragging the stick (multi-touch)", () => {
      renderStick();
      const zone = screen.getByTestId("remote-input-stick-zone");
      setupZoneGeometry(zone);

      fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 }); // up
      onHeldInputsChangeMock.mockClear();

      // A second finger (e.g. reaching for fire) lands on/moves across the
      // stick zone with a DIFFERENT pointerId - must not steer the stick
      // that pointer 1 is already controlling.
      fireEvent.pointerMove(zone, { pointerId: 2, clientX: 140, clientY: 100 }); // would be "right"

      expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
    });

    it("survives a long, rapid circular drag without desyncing the reported direction from the final position", () => {
      render(<LivingJoystick />);
      const zone = screen.getByTestId("remote-input-stick-zone");
      setupZoneGeometry(zone);

      fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
      const steps = 40;
      for (let i = 0; i < steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        fireEvent.pointerMove(zone, {
          pointerId: 1,
          clientX: 100 + Math.round(Math.cos(angle) * 50),
          clientY: 100 + Math.round(Math.sin(angle) * 50),
        });
      }
      // End exactly right (angle = 0).
      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 150, clientY: 100 });

      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "true");
    });

    it("degrades gracefully (does not throw, drag still works) when setPointerCapture is unsupported (older WebView)", () => {
      render(<LivingJoystick />);
      const zone = screen.getByTestId("remote-input-stick-zone");
      vi.spyOn(zone, "clientWidth", "get").mockReturnValue(120);
      zone.setPointerCapture = vi.fn(() => {
        throw new Error("setPointerCapture unsupported");
      });

      expect(() => {
        fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
        fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 });
      }).not.toThrow();
      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "true");
    });

    it("handles rapid repeated press/release of fire without ever leaving it stuck held", () => {
      render(<LivingJoystick />);
      const fireButton = screen.getByTestId("remote-input-fire-button");

      for (let i = 0; i < 30; i += 1) {
        fireEvent.pointerDown(fireButton);
        fireEvent.pointerUp(fireButton);
      }

      expect(fireButton).toHaveAttribute("data-pressed", "false");
    });

    it("pointercancel on the fire button releases it even mid-press-without-up (dropped event safety)", () => {
      render(<LivingJoystick />);
      const fireButton = screen.getByTestId("remote-input-fire-button");

      fireEvent.pointerDown(fireButton);
      expect(fireButton).toHaveAttribute("data-pressed", "true");
      fireEvent.pointerCancel(fireButton);

      expect(fireButton).toHaveAttribute("data-pressed", "false");
    });

    it("a drag that returns to the dead zone and back out again re-fires the direction (no stuck 'changed' latch)", () => {
      render(<LivingJoystick />);
      const zone = screen.getByTestId("remote-input-stick-zone");
      setupZoneGeometry(zone);

      fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 }); // up
      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "true");

      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 101, clientY: 100 }); // back to dead zone
      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "false");

      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 }); // out again
      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "true");
    });

    it("swapping ports mid-gesture does not itself alter the currently-held stick direction (port state and held-set are independent)", () => {
      render(<LivingJoystick />);
      const zone = screen.getByTestId("remote-input-stick-zone");
      setupZoneGeometry(zone);

      fireEvent.pointerDown(zone, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(zone, { pointerId: 1, clientX: 100, clientY: 60 }); // up
      fireEvent.click(screen.getByTestId("remote-input-port-switch"));

      expect(screen.getByTestId("remote-input-stick-thumb")).toHaveAttribute("data-pressed", "true");
      expect(setPortMock).toHaveBeenCalledWith(1);
    });
  });

  describe("movement style toggle (Stick / D-Pad / Swipe)", () => {
    it("defaults to Stick", () => {
      renderStick();
      expect(screen.getByTestId("remote-input-stick-zone")).toBeInTheDocument();
    });

    it("keeps Port on the left rail and stacks Autofire above FIRE in the standard layout", () => {
      renderStick();

      const portToggle = screen.getByTestId("remote-input-port-toggle");
      const movementStyleToggle = screen.getByTestId("remote-input-movement-style-toggle");
      expect(portToggle.compareDocumentPosition(movementStyleToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      const fireStack = screen.getByTestId("remote-input-fire-button").parentElement;
      expect(fireStack).toHaveClass("flex-col-reverse");
      expect(screen.getByTestId("remote-input-autofire-toggle")).toBeInTheDocument();
    });

    it("switches between all three touch styles' surfaces", () => {
      renderStick();

      fireEvent.click(screen.getByTestId("remote-input-movement-style-dpad"));
      expect(screen.getByTestId("remote-input-virtual-dpad")).toBeInTheDocument();
      expect(screen.queryByTestId("remote-input-stick-zone")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("remote-input-movement-style-swipe"));
      expect(screen.getByTestId("remote-input-swipe-pad")).toBeInTheDocument();
      expect(screen.queryByTestId("remote-input-virtual-dpad")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("remote-input-movement-style-stick"));
      expect(screen.getByTestId("remote-input-stick-zone")).toBeInTheDocument();
      expect(screen.queryByTestId("remote-input-swipe-pad")).not.toBeInTheDocument();
    });

    // HARD15-005: the outgoing control unmounts before its own pointer-up can
    // fire, so a held direction must be stripped explicitly on switch or it
    // stays pressed on the device with an unbounded window.
    it("strips held directions (but preserves fire) when switching movement style", () => {
      renderStick(new Set(["right", "fire"]));

      fireEvent.click(screen.getByTestId("remote-input-movement-style-dpad"));

      expect(onHeldInputsChangeMock).toHaveBeenCalledTimes(1);
      const strippedSet = onHeldInputsChangeMock.mock.calls[0][0] as Set<string>;
      expect(strippedSet.has("right")).toBe(false);
      expect(strippedSet.has("fire")).toBe(true);
    });

    it("makes no call when switching movement style with no direction held (avoid a redundant flush)", () => {
      renderStick(new Set(["fire"]));

      fireEvent.click(screen.getByTestId("remote-input-movement-style-dpad"));
      fireEvent.click(screen.getByTestId("remote-input-movement-style-swipe"));
      fireEvent.click(screen.getByTestId("remote-input-movement-style-stick"));

      expect(onHeldInputsChangeMock).not.toHaveBeenCalled();
    });

    it("hides the movement-style selector in game mode so it is a focused control surface", () => {
      const { rerender } = render(
        <VirtualJoystick
          port={2}
          onSetPort={setPortMock}
          heldInputs={EMPTY_HELD_JOYSTICK_INPUTS as never}
          onHeldInputsChange={onHeldInputsChangeMock}
          autofireEnabled={false}
          onAutofireEnabledChange={setAutofireEnabledChangeMock}
          autofireRateHz={5}
          onAutofireRateHzChange={() => {}}
        />,
      );
      expect(screen.getByTestId("remote-input-movement-style-toggle")).toBeInTheDocument();

      rerender(
        <VirtualJoystick
          port={2}
          onSetPort={setPortMock}
          heldInputs={EMPTY_HELD_JOYSTICK_INPUTS as never}
          onHeldInputsChange={onHeldInputsChangeMock}
          autofireEnabled={false}
          onAutofireEnabledChange={setAutofireEnabledChangeMock}
          autofireRateHz={5}
          onAutofireRateHzChange={() => {}}
          immersive
        />,
      );
      // The secondary input-style setting is gone, but the essentials remain.
      expect(screen.queryByTestId("remote-input-movement-style-toggle")).not.toBeInTheDocument();
      expect(screen.getByTestId("remote-input-stick-zone")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-fire-button")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-port-toggle")).toBeInTheDocument();
      const fireStack = screen.getByTestId("remote-input-fire-button").parentElement;
      expect(fireStack).toHaveClass("flex-col-reverse");
      expect(screen.getByTestId("remote-input-autofire-toggle")).toBeInTheDocument();
    });

    it("does not allow switching style while disabled", () => {
      render(
        <VirtualJoystick
          port={2}
          onSetPort={setPortMock}
          heldInputs={EMPTY_HELD_JOYSTICK_INPUTS as never}
          onHeldInputsChange={onHeldInputsChangeMock}
          autofireEnabled={false}
          onAutofireEnabledChange={setAutofireEnabledChangeMock}
          autofireRateHz={5}
          onAutofireRateHzChange={() => {}}
          disabled
        />,
      );

      expect(screen.getByTestId("remote-input-movement-style-dpad")).toBeDisabled();
    });
  });
});
