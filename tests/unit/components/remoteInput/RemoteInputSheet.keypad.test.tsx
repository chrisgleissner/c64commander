/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const initialConnectionStatus: "idle" | "error" = "idle";

const t9 = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/input/t9Defaults", () => ({ isDefaultT9InputEnabled: () => t9.on }));

const mirrorState = vi.hoisted(() => ({ videoState: "off" as "off" | "live" }));
vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => ({
    audio: { state: "off", error: null, fps: 0 },
    video: { state: mirrorState.videoState, error: null, fps: 0 },
    audioLive: false,
    videoLive: mirrorState.videoState === "live",
    anyLive: mirrorState.videoState === "live",
    toggleAudio: vi.fn(),
    toggleVideo: vi.fn(),
    stopAll: vi.fn(),
    session: { stopVideo: vi.fn(async () => {}), stopAudio: vi.fn(async () => {}) },
  }),
  useAvMirrorCanvas: vi.fn(),
}));

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
    // Mirrors useRemoteInputSession.releaseAllEpoch: bumped by releaseAll (and the
    // setOutputMode that internally calls it) so the sheet resets its physical-key
    // refs on the EXPLICIT signal, not on an empty shared set.
    const [releaseAllEpoch, setReleaseAllEpoch] = useState(0);
    return {
      outputMode,
      setOutputMode: (mode: "joystick" | "type") => {
        if (mode === outputMode) return;
        // Mirrors the real hook's setOutputMode, which calls releaseAll()
        // (clearing the held sets + bumping the epoch) before applying the mode -
        // the E2 test below depends on this being faithful to the real hook.
        setHeldJoystickInputsState(new Set());
        setHeldKeyboardInputsState(new Set());
        setReleaseAllEpoch((epoch) => epoch + 1);
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
      connectionStatus: initialConnectionStatus,
      sendChar: sendCharMock,
      sendKeyboardInputs: sendKeyboardInputsMock,
      sendCursor: sendCursorMock,
      sendSpecialKey: sendSpecialKeyMock,
      // Mirrors the real hook's releaseAll, which clears BOTH held sets AND bumps
      // releaseAllEpoch (the panic button / backgrounding path). The epoch bump is
      // what lets the HARD21-006 test exercise the sheet's effect that resets its
      // physical-key refs on an explicit release-all.
      releaseAll: () => {
        setHeldJoystickInputsState(new Set());
        setHeldKeyboardInputsState(new Set());
        setReleaseAllEpoch((epoch) => epoch + 1);
        releaseAllMock();
      },
      releaseAllEpoch,
    };
  },
}));
import { RemoteInputSheet } from "@/components/remoteInput/RemoteInputSheet";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { DisplayProfileProvider, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";
import type { DisplayProfile } from "@/lib/displayProfiles";

const sheet = () => screen.getByTestId("remote-input-sheet");
const press = (key: string, code = key) => {
  const target = document.activeElement ?? sheet();
  fireEvent.keyDown(target, { key, code });
  fireEvent.keyUp(target, { key, code });
};
const renderSheet = (onOpenChange = vi.fn()) => {
  render(
    <FocusNavigationProvider>
      <RemoteInputSheet open onOpenChange={onOpenChange} />
    </FocusNavigationProvider>,
  );
  return onOpenChange;
};
const renderSheetOnKeypad = (onOpenChange = vi.fn()) => {
  render(
    <FocusNavigationProvider profileId="keypad">
      <RemoteInputSheet open onOpenChange={onOpenChange} />
    </FocusNavigationProvider>,
  );
  return onOpenChange;
};
const typedChars = () => sendCharMock.mock.calls.map(([char]) => char);
const openMenu = () => fireEvent.keyDown(document.activeElement ?? sheet(), { key: "SoftRight", code: "SoftRight" });

const ProfilePin = ({ profile }: { profile: DisplayProfile }) => {
  const { setOverride } = useDisplayProfilePreference();
  useEffect(() => setOverride(profile), [profile, setOverride]);
  return <RemoteInputSheet open onOpenChange={vi.fn()} />;
};
const renderSheetAt = (profile: DisplayProfile) =>
  render(
    <FocusNavigationProvider>
      <DisplayProfileProvider>
        <ProfilePin profile={profile} />
      </DisplayProfileProvider>
    </FocusNavigationProvider>,
  );

describe("RemoteInputSheet keypad", () => {
  beforeEach(() => {
    tierState.tier = "full";
    initialSessionOutputMode = "joystick";
    initialSessionHeldJoystickInputs = new Set();
    initialSessionHeldKeyboardInputs = new Set();
    t9.on = true;
    mirrorState.videoState = "off";
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps OK as fire after a direction key while driving the C64", () => {
    renderSheet();
    sheet().focus();

    press("ArrowDown");
    expect(document.activeElement).toBe(sheet());
    setHeldJoystickInputsMock.mockClear();
    fireEvent.keyDown(document.activeElement ?? sheet(), { key: "Enter", code: "Enter" });

    expect(setHeldJoystickInputsMock).toHaveBeenCalledWith(new Set(["fire"]));
    expect(document.activeElement).toBe(sheet());
  });

  it("opens the controls menu on the right soft key and switches to Keys from it", () => {
    renderSheet();
    sheet().focus();

    fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });
    const keys = screen.getByTestId("remote-input-menu-keys");
    expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
    fireEvent.click(keys);

    expect(setOutputModeMock).toHaveBeenCalledWith("type");
  });

  it("returns to driving on Back after operating the sheet's controls, instead of closing it", () => {
    const onOpenChange = renderSheet();
    sheet().focus();
    fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });
    fireEvent.click(screen.getByTestId("remote-input-menu-controls"));
    expect(sheet()).not.toHaveAttribute("data-key-nav-skip");

    // While the sheet's controls have the keypad, OK presses them and nothing reaches the C64.
    setHeldJoystickInputsMock.mockClear();
    fireEvent.keyDown(sheet(), { key: "Enter", code: "Enter" });
    expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();

    fireEvent.keyDown(sheet(), { key: "Escape", code: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sheet()).toHaveAttribute("data-key-nav-skip");
  });

  it("types a BASIC line on the C64 from the keypad in Keys mode, as taps only", () => {
    vi.useFakeTimers();
    initialSessionOutputMode = "type";
    renderSheet();
    sheet().focus();
    const digit = (d: number, times = 1) => {
      for (let i = 0; i < times; i += 1) press(String(d), `Digit${d}`);
    };
    const pause = () => act(() => void vi.advanceTimersByTime(1100));

    press("#");
    digit(1);
    digit(0);
    press("#");
    digit(0); // space
    digit(7); // p
    pause();
    digit(7, 3); // r
    digit(4, 3); // i
    digit(6, 2); // n
    digit(8); // t
    press("Enter");

    expect(sendCharMock.mock.calls.map(([char]) => char)).toEqual(["1", "0", " ", "p", "r", "i", "n", "t", "\r"]);
    expect(setHeldJoystickInputsMock).not.toHaveBeenCalledWith(expect.objectContaining({ size: 1 }));
    expect(setHeldKeyboardInputsMock).not.toHaveBeenCalled();
  });

  it("leaves a keyboard's digits alone in Keys mode where the edition does not use T9", () => {
    t9.on = false;
    initialSessionOutputMode = "type";
    renderSheet();
    sheet().focus();

    press("2", "Digit2");
    press("Enter");

    expect(sendCharMock).not.toHaveBeenCalled();
  });

  it("lets Down walk the on-screen keys in Keys mode where the keypad does not type on the C64", () => {
    t9.on = false;
    initialSessionOutputMode = "type";
    renderSheet();
    sheet().focus();

    press("ArrowDown");

    expect(sheet()).not.toHaveAttribute("data-key-nav-skip");
    expect(document.activeElement).not.toBe(sheet());
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
  });

  it("sends the cursor keys and drops a half-chosen letter when Keys mode is left from the menu", () => {
    vi.useFakeTimers();
    initialSessionOutputMode = "type";
    renderSheet();
    sheet().focus();

    press("ArrowUp");
    press("ArrowRight");
    press("2", "Digit2");
    fireEvent.keyDown(sheet(), { key: "Escape", code: "Escape" });
    fireEvent.click(screen.getByTestId("remote-input-menu-joystick"));
    act(() => void vi.advanceTimersByTime(1100));

    expect(sendCursorMock.mock.calls.map(([direction]) => direction)).toEqual(["up", "right"]);
    expect(sendCharMock).not.toHaveBeenCalled();
    expect(setOutputModeMock).toHaveBeenCalledWith("joystick");
  });

  it("moves to the sheet's first control from the menu, and back to the C64 from the menu", async () => {
    renderSheet();
    sheet().focus();
    fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });
    fireEvent.click(screen.getByTestId("remote-input-menu-controls"));
    await waitFor(() => expect(screen.getByTestId("remote-input-mode-joystick")).toHaveFocus());

    fireEvent.keyDown(document.activeElement ?? sheet(), { key: "SoftRight", code: "SoftRight" });
    fireEvent.click(screen.getByTestId("remote-input-menu-drive"));

    await waitFor(() => expect(sheet()).toHaveFocus());
    expect(sheet()).toHaveAttribute("data-key-nav-skip");
  });

  it("closes the controls menu on a second right soft key press, without reaching the C64", () => {
    renderSheet();
    sheet().focus();

    fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });
    const menu = screen.getByTestId("remote-input-controls-menu");
    fireEvent.keyDown(document.activeElement ?? menu, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? menu, { key: "SoftRight", code: "SoftRight" });

    expect(screen.queryByTestId("remote-input-controls-menu")).not.toBeInTheDocument();
    expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
  });

  it("offers Exit Game Mode, and no switch to Keys or Options, while in Game Mode", () => {
    renderSheet();
    fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));
    expect(sheet()).toHaveAttribute("data-game-mode", "true");
    sheet().focus();

    fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });

    expect(screen.getByTestId("remote-input-menu-game")).toHaveTextContent("Exit Game Mode");
    expect(screen.queryByTestId("remote-input-menu-keys")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remote-input-menu-options")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("remote-input-menu-game"));
    expect(sheet()).toHaveAttribute("data-game-mode", "false");
  });

  it("releases all, enters Game Mode and closes the sheet from the controls menu", () => {
    const onOpenChange = renderSheet();
    sheet().focus();
    const choose = (id: string) => {
      fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });
      fireEvent.click(screen.getByTestId(`remote-input-menu-${id}`));
    };

    choose("release-all");
    expect(releaseAllMock).toHaveBeenCalledTimes(1);
    choose("game");
    expect(sheet()).toHaveAttribute("data-game-mode", "true");
    choose("close");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers Options only where the sheet folds them behind a button, and focuses that button", async () => {
    const { unmount } = renderSheetAt("medium");
    sheet().focus();
    fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });
    expect(screen.queryByTestId("remote-input-menu-options")).not.toBeInTheDocument();
    unmount();

    renderSheetAt("compact");
    sheet().focus();
    fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });
    fireEvent.click(screen.getByTestId("remote-input-menu-options"));

    expect(screen.getByTestId("remote-input-size-stepper")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("remote-input-joystick-options")));
    expect(sheet()).not.toHaveAttribute("data-key-nav-skip");
  });
  it("sends no letter still being chosen once Remote Input has closed", () => {
    vi.useFakeTimers();
    initialSessionOutputMode = "type";
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <FocusNavigationProvider>
        <RemoteInputSheet open onOpenChange={onOpenChange} />
      </FocusNavigationProvider>,
    );
    sheet().focus();

    press("2", "Digit2");
    rerender(
      <FocusNavigationProvider>
        <RemoteInputSheet open={false} onOpenChange={onOpenChange} />
      </FocusNavigationProvider>,
    );
    act(() => void vi.advanceTimersByTime(1100));

    expect(sendCharMock).not.toHaveBeenCalled();
  });

  it("types nothing from the keypad's unbound digits while the keypad drives the joystick", () => {
    vi.useFakeTimers();
    renderSheet();
    sheet().focus();

    // Each layout leaves one of these two unbound: Classic T9 leaves 0, the diamond leaves 2.
    press("0", "Digit0");
    press("2", "Digit2");
    act(() => void vi.advanceTimersByTime(1100));

    expect(sendCharMock).not.toHaveBeenCalled();
  });

  it("types nothing from a key the Live View picture takes while its view is being adjusted", () => {
    vi.useFakeTimers();
    mirrorState.videoState = "live";
    initialSessionOutputMode = "type";
    renderSheet();
    sheet().focus();

    press("*", "Star");
    expect(screen.getByTestId("remote-input-mirror-adjust-hint")).toBeInTheDocument();
    press("2", "Digit2");
    press("Enter");
    act(() => void vi.advanceTimersByTime(1100));

    expect(sendCharMock).not.toHaveBeenCalled();
  });

  it("gives the sheet focus back on Back after operating its controls, so OK fires again", async () => {
    renderSheet();
    sheet().focus();
    openMenu();
    fireEvent.click(screen.getByTestId("remote-input-menu-controls"));
    await waitFor(() => expect(screen.getByTestId("remote-input-mode-joystick")).toHaveFocus());

    fireEvent.keyDown(screen.getByTestId("remote-input-mode-joystick"), { key: "Escape", code: "Escape" });

    expect(sheet()).toHaveFocus();
  });

  it("marks the right soft key handled when it opens the menu", () => {
    renderSheet();
    sheet().focus();

    const notPrevented = fireEvent.keyDown(sheet(), { key: "SoftRight", code: "SoftRight" });

    expect(notPrevented).toBe(false);
    expect(screen.getByTestId("remote-input-controls-menu")).toBeInTheDocument();
  });

  it("opens the menu on its first item, so the first OK chooses it", async () => {
    renderSheet();
    sheet().focus();

    openMenu();

    await waitFor(() => expect(screen.getByTestId("remote-input-menu-keys")).toHaveFocus());
  });

  it("offers no Release all in Game Mode, where the sheet does not show one", () => {
    renderSheet();
    fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));
    expect(screen.queryByTestId("remote-input-panic-button")).not.toBeInTheDocument();
    sheet().focus();

    openMenu();

    expect(screen.getByTestId("remote-input-menu-close")).toBeInTheDocument();
    expect(screen.queryByTestId("remote-input-menu-release-all")).not.toBeInTheDocument();
  });

  it("returns to driving on a keypad's own left soft key after operating the sheet's controls", async () => {
    const onOpenChange = renderSheetOnKeypad();
    sheet().focus();
    openMenu();
    fireEvent.click(screen.getByTestId("remote-input-menu-controls"));
    await waitFor(() => expect(screen.getByTestId("remote-input-mode-joystick")).toHaveFocus());

    fireEvent.keyDown(screen.getByTestId("remote-input-mode-joystick"), { key: "SoftLeft", code: "SoftLeft" });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sheet()).toHaveAttribute("data-key-nav-skip");
    expect(sheet()).toHaveFocus();
  });

  it("closes on a keypad's own left soft key while the keypad drives the joystick", () => {
    const onOpenChange = renderSheetOnKeypad();
    sheet().focus();

    fireEvent.keyDown(sheet(), { key: "SoftLeft", code: "SoftLeft" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe("typing in Keys mode", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      initialSessionOutputMode = "type";
    });

    it("deletes on the C64 with the right soft key, and drops a letter still being chosen first", () => {
      renderSheet();
      sheet().focus();

      press("2", "Digit2");
      press("SoftRight");
      act(() => void vi.advanceTimersByTime(1100));
      expect(sendCharMock).not.toHaveBeenCalled();
      press("SoftRight");

      expect(typedChars()).toEqual(["\b"]);
      expect(screen.queryByTestId("remote-input-controls-menu")).not.toBeInTheDocument();
    });

    it("opens the menu on Back instead of closing, and Back closes the menu again", () => {
      const onOpenChange = renderSheet();
      sheet().focus();

      fireEvent.keyDown(sheet(), { key: "Escape", code: "Escape" });
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByTestId("remote-input-controls-menu")).toBeInTheDocument();
      fireEvent.keyDown(document.activeElement ?? sheet(), { key: "Escape", code: "Escape" });

      expect(screen.queryByTestId("remote-input-controls-menu")).not.toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("opens the menu on a keypad's own left soft key, and closes Remote Input from it", () => {
      const onOpenChange = renderSheetOnKeypad();
      sheet().focus();

      fireEvent.keyDown(sheet(), { key: "SoftLeft", code: "SoftLeft" });
      fireEvent.click(screen.getByTestId("remote-input-menu-close"));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("closes the menu with the right soft key while typing, without deleting", () => {
      renderSheet();
      sheet().focus();
      fireEvent.keyDown(sheet(), { key: "Escape", code: "Escape" });

      fireEvent.keyDown(document.activeElement ?? sheet(), { key: "SoftRight", code: "SoftRight" });

      expect(screen.queryByTestId("remote-input-controls-menu")).not.toBeInTheDocument();
      expect(sendCharMock).not.toHaveBeenCalled();
    });

    it("types lower-case letters only, and skips the symbol the C64 has no key for", () => {
      renderSheet();
      sheet().focus();

      press("*", "Star");
      press("2", "Digit2");
      press("*", "Star");
      act(() => void vi.advanceTimersByTime(1100));
      for (let i = 0; i < 6; i += 1) press("1", "Digit1");
      act(() => void vi.advanceTimersByTime(1100));

      expect(typedChars()).toEqual(["a", ":"]);
    });
  });
});
