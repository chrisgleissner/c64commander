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

  // HARD13-004: RUN/STOP and RESTORE have no kernal keyboard-buffer equivalent,
  // so on the fallback tier the session drops them silently. The buttons must be
  // explicitly disabled (like CTRL/C=), not left live-looking dead controls.
  it("disables RUN/STOP and RESTORE on the kernal-fallback tier (no fallback equivalent)", () => {
    tierState.tier = "kernal-fallback";
    initialSessionOutputMode = "type";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    const runStopButtons = screen.getAllByTestId("remote-input-key-run-stop");
    expect(runStopButtons.length).toBeGreaterThan(0);
    runStopButtons.forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByTestId("remote-input-key-restore")).toBeDisabled();
  });

  // HARD13 accessibility: adjustable control size, persisted, so big fingers on
  // small screens get usable controls.
  it("adjusts and persists the control size via the size stepper", () => {
    localStorage.clear();
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("remote-input-size-label").textContent).toBe("L"); // default (above the old cramped M)

    fireEvent.click(screen.getByTestId("remote-input-size-increase"));
    expect(screen.getByTestId("remote-input-size-label").textContent).toBe("XL");
    expect(localStorage.getItem("c64u_remote_input_control_size")).toBe("XL");

    fireEvent.click(screen.getByTestId("remote-input-size-decrease"));
    fireEvent.click(screen.getByTestId("remote-input-size-decrease"));
    expect(screen.getByTestId("remote-input-size-label").textContent).toBe("M");
    expect(screen.getByTestId("remote-input-size-decrease")).toBeDisabled(); // clamped at min
  });

  // HARD13 accessibility: immersive "game mode" strips everything but the
  // joystick action controls for no-look play.
  it("game mode hides the mode toggle and quick-keys bar, keeping only joystick controls", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("remote-input-output-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("remote-input-quick-keys-bar")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));

    expect(screen.queryByTestId("remote-input-output-mode-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remote-input-quick-keys-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("remote-input-virtual-joystick")).toBeInTheDocument();
    expect(screen.getByTestId("remote-input-fire-button")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));
    expect(screen.getByTestId("remote-input-output-mode-toggle")).toBeInTheDocument();
  });

  it("offers game mode only in Joystick mode on a joystick-capable tier", () => {
    initialSessionOutputMode = "type";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    expect(screen.queryByTestId("remote-input-immersive-toggle")).not.toBeInTheDocument();
  });

  it("does not offer game mode on the kernal-fallback tier", () => {
    tierState.tier = "kernal-fallback";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    expect(screen.queryByTestId("remote-input-immersive-toggle")).not.toBeInTheDocument();
  });

  describe("Joystick vs Type interaction separation", () => {
    // The Type-tab Cursor Pad and the Joystick D-pad share a visual component
    // but must NEVER share action semantics: the Cursor Pad emits keyboard
    // cursor movement, the D-pad emits joystick directions, and neither leaks
    // into the other's channel.
    it("routes the Type-tab cursor pad to keyboard cursor movement, never the joystick held set", () => {
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByTestId("remote-input-key-cursor-up"));

      expect(sendCursorMock).toHaveBeenCalledWith("up");
      expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
    });

    it("routes the Joystick D-pad to the joystick held set, never keyboard cursor movement", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByTestId("remote-input-movement-style-dpad"));
      fireEvent.pointerDown(screen.getByTestId("remote-input-dpad-up"));

      expect(setHeldJoystickInputsMock).toHaveBeenCalledWith(new Set(["up"]));
      expect(sendCursorMock).not.toHaveBeenCalled();
    });

    it("keeps Release All and Exit reachable in Type mode alongside the keyboard", () => {
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      expect(screen.getByTestId("remote-input-type-keyboard")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-panic-button")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-exit-button")).toBeInTheDocument();
    });

    it("hides the joystick-only size stepper and quick-keys bar in Type mode", () => {
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      expect(screen.queryByTestId("remote-input-size-stepper")).not.toBeInTheDocument();
      expect(screen.queryByTestId("remote-input-quick-keys-bar")).not.toBeInTheDocument();
    });
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
