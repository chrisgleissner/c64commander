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

const tierState = { tier: "full" as "full" | "kernal-fallback" | "auth-required" };

const setOutputModeMock = vi.fn();
const setHeldJoystickInputsMock = vi.fn();
const setPortMock = vi.fn();
const setAutofireEnabledMock = vi.fn();
const sendCharMock = vi.fn();
const sendKeyboardInputsMock = vi.fn();
const sendCursorMock = vi.fn();
const sendSpecialKeyMock = vi.fn();
const releaseAllMock = vi.fn();

let initialSessionOutputMode: "joystick" | "type" = "joystick";

vi.mock("@/hooks/useRemoteInputCapabilityTier", () => ({
  useRemoteInputCapabilityTier: () => tierState,
}));

// Uses real React state for outputMode (unlike a plain module-variable mock)
// so that calling setOutputMode actually re-renders the sheet, matching the
// real hook - needed to test effects that react to outputMode changing.
vi.mock("@/hooks/useRemoteInputSession", () => ({
  useRemoteInputSession: () => {
    const [outputMode, setOutputModeState] = useState<"joystick" | "type">(initialSessionOutputMode);
    return {
      outputMode,
      setOutputMode: (mode: "joystick" | "type") => {
        setOutputModeState(mode);
        setOutputModeMock(mode);
      },
      port: 2,
      setPort: setPortMock,
      heldJoystickInputs: new Set(),
      setHeldJoystickInputs: setHeldJoystickInputsMock,
      autofireEnabled: false,
      setAutofireEnabled: setAutofireEnabledMock,
      autofireRateHz: 10,
      setAutofireRateHz: vi.fn(),
      connectionStatus: "idle",
      sendChar: sendCharMock,
      sendKeyboardInputs: sendKeyboardInputsMock,
      sendCursor: sendCursorMock,
      sendSpecialKey: sendSpecialKeyMock,
      releaseAll: releaseAllMock,
    };
  },
}));

import { RemoteInputSheet } from "@/components/remoteInput/RemoteInputSheet";

describe("RemoteInputSheet", () => {
  beforeEach(() => {
    tierState.tier = "full";
    initialSessionOutputMode = "joystick";
    vi.clearAllMocks();
  });

  it("switches output mode when the Type button is pressed", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("remote-input-mode-type"));
    expect(setOutputModeMock).toHaveBeenCalledWith("type");
  });

  it("disables Joystick mode and shows the unavailable hint on the kernal-fallback tier", () => {
    tierState.tier = "kernal-fallback";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("remote-input-mode-joystick")).toBeDisabled();
    expect(screen.getAllByText(/machine:input support/i).length).toBeGreaterThan(0);
  });

  it("calls releaseAll when the panic button is pressed", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("remote-input-panic-button"));
    expect(releaseAllMock).toHaveBeenCalledTimes(1);
  });

  it("releases all inputs and closes when the exit button is pressed", () => {
    const onOpenChange = vi.fn();
    render(<RemoteInputSheet open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByTestId("remote-input-exit-button"));
    expect(releaseAllMock).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("routes a physical D-pad key press to the joystick held set while in Joystick mode, not focus navigation", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const sheet = screen.getByTestId("remote-input-sheet");

    fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });

    expect(setHeldJoystickInputsMock).toHaveBeenCalledWith(new Set(["up"]));
  });

  it("releases the physical direction on key up", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const sheet = screen.getByTestId("remote-input-sheet");

    fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });
    setHeldJoystickInputsMock.mockClear();
    fireEvent.keyUp(sheet, { code: "ArrowUp", key: "ArrowUp" });

    expect(setHeldJoystickInputsMock).toHaveBeenCalledWith(new Set());
  });

  it("ignores physical direction keys while in Type mode (no joystick relay)", () => {
    initialSessionOutputMode = "type";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const sheet = screen.getByTestId("remote-input-sheet");

    fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });

    expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
  });

  it("does not repeatedly re-add a held direction on OS key-repeat", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const sheet = screen.getByTestId("remote-input-sheet");

    fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });
    setHeldJoystickInputsMock.mockClear();
    fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp", repeat: true });

    expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
  });

  it("latches SHIFT on the on-screen keyboard, applies it to the next key, then auto-clears", () => {
    initialSessionOutputMode = "type";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId("remote-input-key-shift"));
    fireEvent.click(screen.getByTestId("remote-input-key-a"));

    expect(sendKeyboardInputsMock).toHaveBeenCalledWith(["a", "left_shift"]);

    sendKeyboardInputsMock.mockClear();
    fireEvent.click(screen.getByTestId("remote-input-key-a"));

    expect(sendKeyboardInputsMock).toHaveBeenCalledWith(["a"]);
  });

  it("routes the quick-keys bar to the session's char/cursor/special-key handlers", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getAllByTestId("remote-input-key-space")[0]);
    expect(sendCharMock).toHaveBeenCalledWith(" ");

    fireEvent.click(screen.getAllByTestId("remote-input-key-run-stop")[0]);
    expect(sendSpecialKeyMock).toHaveBeenCalledWith("run_stop");
  });

  describe("edge cases and stress (physical key storms, T9, diagonals)", () => {
    // Joystick movement must work via all four paths: hardware D-pad, a
    // regular keyboard's cursor/arrow keys, the virtual stick/D-pad/swipe on
    // touch, or the physical T9 keypad. This proves the keyboard path
    // specifically - it shares the same code with the hardware D-pad (both
    // resolve through the same semantic-action keymap), which is intentional:
    // a USB/Bluetooth keyboard's arrow keys and a physical D-pad emit the
    // identical `code` values, so one mapping correctly serves both.
    it("drives the joystick via a regular keyboard's cursor/arrow keys, all four directions", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      (
        [
          ["ArrowUp", "up"],
          ["ArrowDown", "down"],
          ["ArrowLeft", "left"],
          ["ArrowRight", "right"],
        ] as const
      ).forEach(([code, direction]) => {
        fireEvent.keyDown(sheet, { code, key: code });
        expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set([direction]));
        fireEvent.keyUp(sheet, { code, key: code });
        expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set());
      });
    });

    it("combines two simultaneously-held direction keys into a diagonal held set", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });
      fireEvent.keyDown(sheet, { code: "ArrowLeft", key: "ArrowLeft" });

      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["up", "left"]));
    });

    it("releases keys in a different order than they were pressed, leaving only the still-held one", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });
      fireEvent.keyDown(sheet, { code: "ArrowLeft", key: "ArrowLeft" });
      fireEvent.keyDown(sheet, { code: "Digit5", key: "5" }); // T9 fire
      setHeldJoystickInputsMock.mockClear();

      // Release the FIRST-pressed key last, and an unrelated key never pressed at all.
      fireEvent.keyUp(sheet, { code: "ArrowLeft", key: "ArrowLeft" });
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["up", "fire"]));

      fireEvent.keyUp(sheet, { code: "Digit9", key: "9" }); // spurious, never held
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["up", "fire"]));

      fireEvent.keyUp(sheet, { code: "ArrowUp", key: "ArrowUp" });
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["fire"]));
    });

    it("drives the joystick via T9 numeric-keypad digits, including diagonals", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.keyDown(sheet, { code: "Digit7", key: "7" }); // down-left diagonal
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["down", "left"]));

      fireEvent.keyUp(sheet, { code: "Digit7", key: "7" });
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set());
    });

    it("survives a rapid storm of 100 alternating direction key presses without throwing or losing sync", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      expect(() => {
        for (let i = 0; i < 100; i += 1) {
          const code = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"][i % 4];
          fireEvent.keyDown(sheet, { code, key: code });
          fireEvent.keyUp(sheet, { code, key: code });
        }
      }).not.toThrow();

      // Every key was released 1:1 with its press - final state must be empty.
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set());
    });

    it("does not double-count OS key-repeat as multiple presses across a long repeat storm", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });
      const callsAfterFirstPress = setHeldJoystickInputsMock.mock.calls.length;
      for (let i = 0; i < 50; i += 1) {
        fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp", repeat: true });
      }

      expect(setHeldJoystickInputsMock.mock.calls.length).toBe(callsAfterFirstPress);
    });

    it("stops relaying physical keys as joystick input once switched to Type mode mid-hold", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });
      fireEvent.click(screen.getByTestId("remote-input-mode-type"));
      setHeldJoystickInputsMock.mockClear();

      // A new physical key press in Type mode must never be treated as joystick input.
      fireEvent.keyDown(sheet, { code: "ArrowRight", key: "ArrowRight" });
      expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
    });

    // Regression: a direction held while switching to Type mode (a real-world
    // race - the user's thumb never lifts, so no keyup ever arrives for it)
    // used to stay recorded in the sheet's own physical-key tracking ref.
    // Switching back to Joystick mode later and pressing a genuinely NEW key
    // then resurrected the stale direction as phantom-held alongside it.
    it("does not resurrect a direction left held across a Type-mode round-trip (phantom stuck input)", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" }); // never released
      fireEvent.click(screen.getByTestId("remote-input-mode-type"));
      fireEvent.click(screen.getByTestId("remote-input-mode-joystick"));
      setHeldJoystickInputsMock.mockClear();

      fireEvent.keyDown(sheet, { code: "ArrowRight", key: "ArrowRight" });

      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["right"]));
    });

    it("a key that maps to no joystick or semantic action at all is ignored without side effects", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      expect(() => fireEvent.keyDown(sheet, { code: "Unidentified", key: "Unidentified" })).not.toThrow();
      expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
    });

    it("a non-joystick semantic action key (e.g. star/hash) in Joystick mode does not touch the held set", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.keyDown(sheet, { code: "NumpadMultiply", key: "*" });
      expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
    });
  });
});
