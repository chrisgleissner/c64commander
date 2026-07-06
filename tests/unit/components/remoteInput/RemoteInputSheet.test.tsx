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

const tierState = {
  tier: "full" as "full" | "kernal-fallback" | "auth-required",
  loading: false,
  resolved: true,
};

const setOutputModeMock = vi.fn();
const setHeldJoystickInputsMock = vi.fn();
const setHeldKeyboardInputsMock = vi.fn();
const setPortMock = vi.fn();
const setAutofireEnabledMock = vi.fn();
const sendCharMock = vi.fn();
const sendKeyboardInputsMock = vi.fn();
const sendCursorMock = vi.fn();
const sendSpecialKeyMock = vi.fn();
const releaseAllMock = vi.fn();

let initialSessionOutputMode: "joystick" | "type" = "joystick";
let initialSessionHeldJoystickInputs: ReadonlySet<string> = new Set();
let initialSessionHeldKeyboardInputs: ReadonlySet<string> = new Set();

vi.mock("@/hooks/useRemoteInputCapabilityTier", () => ({
  useRemoteInputCapabilityTier: () => tierState,
}));

// Uses real React state for outputMode and heldJoystickInputs (unlike a plain
// module-variable mock) so that calling setOutputMode/setHeldJoystickInputs
// actually re-renders the sheet, matching the real hook - needed to test
// effects that react to those changing (and, for held inputs, the E2
// merge-not-replace fix in recomputePhysicalHeldSet).
vi.mock("@/hooks/useRemoteInputSession", () => ({
  useRemoteInputSession: () => {
    const [outputMode, setOutputModeState] = useState<"joystick" | "type">(initialSessionOutputMode);
    const [heldJoystickInputs, setHeldJoystickInputsState] = useState<ReadonlySet<string>>(
      initialSessionHeldJoystickInputs,
    );
    const [heldKeyboardInputs, setHeldKeyboardInputsState] = useState<ReadonlySet<string>>(
      initialSessionHeldKeyboardInputs,
    );
    return {
      outputMode,
      setOutputMode: (mode: "joystick" | "type") => {
        if (mode === outputMode) return;
        // Mirrors the real hook's setOutputMode, which calls releaseAll()
        // (clearing the held sets) before applying the mode - the E2 test
        // below depends on this being faithful to the real hook.
        setHeldJoystickInputsState(new Set());
        setHeldKeyboardInputsState(new Set());
        setOutputModeState(mode);
        setOutputModeMock(mode);
      },
      port: 2,
      setPort: setPortMock,
      heldJoystickInputs,
      setHeldJoystickInputs: (next: ReadonlySet<string>) => {
        setHeldJoystickInputsState(next);
        setHeldJoystickInputsMock(next);
      },
      heldKeyboardInputs,
      setHeldKeyboardInputs: (next: ReadonlySet<string>) => {
        setHeldKeyboardInputsState(next);
        setHeldKeyboardInputsMock(next);
      },
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
    tierState.loading = false;
    tierState.resolved = true;
    initialSessionOutputMode = "joystick";
    initialSessionHeldJoystickInputs = new Set();
    initialSessionHeldKeyboardInputs = new Set();
    vi.clearAllMocks();
  });

  it("switches output mode when the Keys button is pressed", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("remote-input-mode-type"));
    expect(setOutputModeMock).toHaveBeenCalledWith("type");
  });

  it("disables Joystick mode and shows the unavailable hint on the kernal-fallback tier", () => {
    tierState.tier = "kernal-fallback";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const joystickToggle = screen.getByTestId("remote-input-mode-joystick");
    expect(joystickToggle).toBeDisabled();
    expect(joystickToggle).toHaveAttribute("title", expect.stringMatching(/joystick relay requires/i));
  });

  // Lead F3: the generic "Type mode still works" hint is wrong on this tier -
  // the fallback injection needs the same password the probe already failed
  // without, so a distinct, accurate hint must be shown instead.
  it("shows the auth-required-specific hint (not the generic 'Type mode still works' one) on the auth-required tier", () => {
    tierState.tier = "auth-required";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId("remote-input-mode-joystick")).toBeDisabled();
    expect(screen.getAllByText(/password/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/type mode still works/i)).not.toBeInTheDocument();
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

  it("drops the tab-bar bottom clearance when the footer is shown, so no dead space sits below Release All / Close", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const sheet = screen.getByTestId("remote-input-sheet");
    expect(sheet.className).toContain("pb-0");
    expect(sheet.className).not.toContain("app-sheet-bottom-clearance");
  });

  it("keeps the bottom clearance in game mode (no footer) so the edge-anchored controls clear the nav bar", () => {
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));
    const sheet = screen.getByTestId("remote-input-sheet");
    expect(sheet.className).toContain("app-sheet-bottom-clearance");
  });

  it("latches SHIFT on the on-screen keyboard, applies it to the next key, then auto-clears", () => {
    // Full tier relays keyboard input via the held-keyboard-inputs set (real
    // press/release), not the one-shot sendKeyboardInputs tap prop - that
    // prop is reserved for the kernal-fallback tier.
    initialSessionOutputMode = "type";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const snapshotsOf = (mock: typeof setHeldKeyboardInputsMock) =>
      mock.mock.calls.map(([next]) => [...(next as ReadonlySet<string>)].sort());

    fireEvent.click(screen.getByTestId("remote-input-key-shift"));
    fireEvent.click(screen.getByTestId("remote-input-key-a"));

    expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["a", "left_shift"]);
    expect(snapshotsOf(setHeldKeyboardInputsMock).at(-1)).toEqual([]);
    expect(sendKeyboardInputsMock).not.toHaveBeenCalled();

    setHeldKeyboardInputsMock.mockClear();
    fireEvent.click(screen.getByTestId("remote-input-key-a"));

    expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["a"]);
    expect(snapshotsOf(setHeldKeyboardInputsMock)).not.toContainEqual(["a", "left_shift"]);
  });

  it("routes the quick-keys bar's SPACE/RUN-STOP through the held-keyboard-inputs set on the full tier", () => {
    // Full tier relays these via real press/release (see
    // useKeyboardHoldDispatch), not the one-shot sendChar/sendSpecialKey tap
    // props - those are reserved for the kernal-fallback tier (see the
    // "falls back to sendChar/sendSpecialKey" test below).
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
    const snapshotsOf = (mock: typeof setHeldKeyboardInputsMock) =>
      mock.mock.calls.map(([next]) => [...(next as ReadonlySet<string>)].sort());

    fireEvent.click(screen.getAllByTestId("remote-input-key-space")[0]);
    expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["space"]);
    expect(sendCharMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByTestId("remote-input-key-run-stop")[0]);
    expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["run_stop"]);
    expect(sendSpecialKeyMock).not.toHaveBeenCalled();
  });

  it("falls back to sendChar/sendSpecialKey for the quick-keys bar on the kernal-fallback tier", () => {
    tierState.tier = "kernal-fallback";
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getAllByTestId("remote-input-key-space")[0]);
    expect(sendCharMock).toHaveBeenCalledWith(" ");
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
    expect(screen.getByTestId("remote-input-panic-button")).toBeInTheDocument();
    expect(screen.getByTestId("remote-input-exit-button")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));

    expect(screen.queryByTestId("remote-input-output-mode-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remote-input-quick-keys-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remote-input-panic-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remote-input-exit-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("remote-input-virtual-joystick")).toBeInTheDocument();
    expect(screen.getByTestId("remote-input-fire-button")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));
    expect(screen.getByTestId("remote-input-output-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("remote-input-panic-button")).toBeInTheDocument();
    expect(screen.getByTestId("remote-input-exit-button")).toBeInTheDocument();
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

    // Smart default: a keyboard-only device (no machine:input support) should
    // open straight into Type mode once the capability probe has settled, rather
    // than presenting a disabled Joystick tab.
    it("defaults to Type mode after the probe settles on a keyboard-only device", () => {
      tierState.tier = "kernal-fallback";
      tierState.loading = true; // probe in flight when the sheet opens
      tierState.resolved = false;
      const { rerender } = render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      // Still probing → do not switch yet.
      expect(setOutputModeMock).not.toHaveBeenCalled();

      // Probe resolves to a tier without joystick support → auto-switch to Type.
      tierState.loading = false;
      tierState.resolved = true;
      rerender(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      expect(setOutputModeMock).toHaveBeenCalledWith("type");
    });

    it("never bounces a full-tier device off Joystick during the capability probe", () => {
      tierState.tier = "full";
      tierState.loading = true;
      tierState.resolved = false;
      const { rerender } = render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      tierState.loading = false;
      tierState.resolved = true;
      rerender(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      expect(setOutputModeMock).not.toHaveBeenCalledWith("type");
    });

    // HARD15-006: a transient connection blip resets the tier hook to the
    // default kernal-fallback/unresolved shape mid-session - indistinguishable
    // from "not yet probed" by tier/loading alone. `resolved` lets the sheet
    // tell the two apart, so the blip disables the Joystick tab instead of
    // yanking the user into Keys mode, and re-enables it once the tier
    // resolves again on reconnect.
    it("does not bounce out of Joystick mode on a transient connection blip, and recovers on reconnect", () => {
      const { rerender } = render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      expect(screen.getByTestId("remote-input-mode-joystick")).toBeEnabled();

      // The tier hook's disconnect-reset path: kernal-fallback/not-loading/
      // unresolved - the same shape a genuine unsupported-device probe would
      // leave, MINUS `resolved`.
      tierState.tier = "kernal-fallback";
      tierState.loading = false;
      tierState.resolved = false;
      rerender(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      expect(setOutputModeMock).not.toHaveBeenCalledWith("type");
      expect(screen.getByTestId("remote-input-mode-joystick")).toBeDisabled();

      // Reconnect: the tier re-resolves to full.
      tierState.tier = "full";
      tierState.resolved = true;
      rerender(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      expect(screen.getByTestId("remote-input-mode-joystick")).toBeEnabled();
    });
  });

  describe("HARD14 naming, tab order, and key-label polish", () => {
    it("titles the modal 'Remote Input' with no 'Couch remote' descriptor", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      expect(screen.getByText("Remote Input")).toBeInTheDocument();
      expect(screen.queryByText(/couch/i)).not.toBeInTheDocument();
    });

    it("orders the mode tabs Joystick then Keys, and never labels a tab 'Type'", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const joystick = screen.getByTestId("remote-input-mode-joystick");
      const keys = screen.getByTestId("remote-input-mode-type");
      expect(joystick).toHaveTextContent("Joystick");
      expect(keys).toHaveTextContent("Keys");
      expect(keys.textContent).not.toMatch(/Type/);
      expect(screen.queryByRole("button", { name: /^Type$/ })).not.toBeInTheDocument();
      // Visual order: Joystick precedes Keys in the DOM.
      expect(joystick.compareDocumentPosition(keys) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("labels the standard footer dismiss action 'Close' (distinct from 'Exit game mode')", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      expect(screen.getByTestId("remote-input-exit-button")).toHaveTextContent("Close");
    });

    it("shows the Commodore key as 'C=' and the cursor keys as arrows (no 'CUR' text)", () => {
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      expect(screen.getByTestId("remote-input-key-commodore")).toHaveTextContent("C=");
      const cursorUp = screen.getByTestId("remote-input-key-cursor-up");
      expect(cursorUp.textContent ?? "").not.toMatch(/CUR/i);
      // Rendered as an icon, not text.
      expect(cursorUp.querySelector("svg")).toBeTruthy();
    });

    it("prints the shifted secondary legend above the main label on number keys", () => {
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      // Secondary "!" comes first in DOM order (rendered on top), then the digit "1".
      expect(screen.getByTestId("remote-input-key-1").textContent).toBe("!1");
    });
  });

  describe("SHIFT LOCK (persistent shift toggle)", () => {
    it("latches shift persistently across multiple keys until toggled off", () => {
      // Full tier relays via the held-keyboard-inputs set (real press/release),
      // not the one-shot sendKeyboardInputs tap prop.
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const snapshotsOf = (mock: typeof setHeldKeyboardInputsMock) =>
        mock.mock.calls.map(([next]) => [...(next as ReadonlySet<string>)].sort());

      const shiftLock = screen.getByTestId("remote-input-key-shift-lock");
      expect(shiftLock).toHaveTextContent(/SHIFT\s*LOCK/);
      fireEvent.click(shiftLock);
      expect(shiftLock).toHaveAttribute("aria-pressed", "true");
      expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["left_shift"]);

      // Every subsequent key carries left_shift — and the lock does NOT clear.
      setHeldKeyboardInputsMock.mockClear();
      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["a", "left_shift"]);
      expect(snapshotsOf(setHeldKeyboardInputsMock).at(-1)).toEqual(["left_shift"]); // lock survives

      setHeldKeyboardInputsMock.mockClear();
      fireEvent.click(screen.getByTestId("remote-input-key-b"));
      expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["b", "left_shift"]);
      expect(snapshotsOf(setHeldKeyboardInputsMock).at(-1)).toEqual(["left_shift"]);

      // Toggling it off returns to unshifted output.
      setHeldKeyboardInputsMock.mockClear();
      fireEvent.click(shiftLock);
      expect(shiftLock).toHaveAttribute("aria-pressed", "false");
      expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual([]);

      setHeldKeyboardInputsMock.mockClear();
      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["a"]);
    });

    it("is distinct from the one-shot SHIFT, which still auto-clears after one key", () => {
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const snapshotsOf = (mock: typeof setHeldKeyboardInputsMock) =>
        mock.mock.calls.map(([next]) => [...(next as ReadonlySet<string>)].sort());

      fireEvent.click(screen.getByTestId("remote-input-key-shift"));
      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["a", "left_shift"]);
      // One-shot SHIFT cleared — the next key is unshifted.
      expect(snapshotsOf(setHeldKeyboardInputsMock).at(-1)).toEqual([]);
      setHeldKeyboardInputsMock.mockClear();
      fireEvent.click(screen.getByTestId("remote-input-key-a"));
      expect(snapshotsOf(setHeldKeyboardInputsMock)).toContainEqual(["a"]);
    });

    it("never goes through the one-shot tap props when toggled (it presses left_shift on the held set instead)", () => {
      initialSessionOutputMode = "type";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByTestId("remote-input-key-shift-lock"));
      expect(sendKeyboardInputsMock).not.toHaveBeenCalled();
      expect(sendCharMock).not.toHaveBeenCalled();
      expect(sendSpecialKeyMock).not.toHaveBeenCalled();
      // Engaging the lock DOES press left_shift for real, immediately.
      expect(setHeldKeyboardInputsMock).toHaveBeenCalledWith(new Set(["left_shift"]));
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

    // HARD13 residual E2: recomputePhysicalHeldSet used to REPLACE the whole
    // held set from physical keys only, dropping a concurrently touch-held
    // input (e.g. fire held via the on-screen button) on a device with both.
    it("merges a physical key press with an already touch-held input instead of replacing the held set", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      const sheet = screen.getByTestId("remote-input-sheet");

      fireEvent.pointerDown(screen.getByTestId("remote-input-fire-button"));
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["fire"]));

      fireEvent.keyDown(sheet, { code: "ArrowUp", key: "ArrowUp" });
      const heldAfterPhysicalPress = setHeldJoystickInputsMock.mock.calls.at(-1)?.[0] as Set<string>;
      expect(heldAfterPhysicalPress.has("fire")).toBe(true);
      expect(heldAfterPhysicalPress.has("up")).toBe(true);

      fireEvent.keyUp(sheet, { code: "ArrowUp", key: "ArrowUp" });
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["fire"]));
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
