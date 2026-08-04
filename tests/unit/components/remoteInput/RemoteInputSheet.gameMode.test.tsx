/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tierState = { tier: "full" as "full" | "kernal-fallback", loading: false, resolved: true };

const setHeldJoystickInputsMock = vi.fn();
const setOutputModeMock = vi.fn();

const mirrorState = vi.hoisted(() => ({
  videoState: "off" as "off" | "live",
  audioLive: false,
  stopVideo: vi.fn(async () => {}),
  stopAudio: vi.fn(async () => {}),
}));

vi.mock("@/hooks/useRemoteInputCapabilityTier", () => ({
  useRemoteInputCapabilityTier: () => tierState,
}));

vi.mock("@/hooks/useAvMirror", () => ({
  useAvMirror: () => ({
    audio: { state: mirrorState.audioLive ? "live" : "off", error: null, fps: 0 },
    video: { state: mirrorState.videoState, error: null, fps: 0 },
    audioLive: mirrorState.audioLive,
    videoLive: mirrorState.videoState === "live",
    anyLive: mirrorState.videoState === "live" || mirrorState.audioLive,
    toggleAudio: vi.fn(),
    toggleVideo: vi.fn(),
    stopAll: vi.fn(),
    session: { stopVideo: mirrorState.stopVideo, stopAudio: mirrorState.stopAudio },
  }),
  useAvMirrorCanvas: vi.fn(),
}));

vi.mock("@/hooks/useRemoteInputSession", () => ({
  useRemoteInputSession: () => {
    const [outputMode, setOutputModeState] = useState<"joystick" | "type">("joystick");
    const [heldJoystickInputs, setHeldJoystickInputsState] = useState<ReadonlySet<string>>(new Set());
    const [releaseAllEpoch, setReleaseAllEpoch] = useState(0);
    return {
      outputMode,
      setOutputMode: (mode: "joystick" | "type") => {
        if (mode === outputMode) return;
        setHeldJoystickInputsState(new Set());
        setReleaseAllEpoch((epoch) => epoch + 1);
        setOutputModeState(mode);
        setOutputModeMock(mode);
      },
      port: 2,
      setPort: vi.fn(),
      heldJoystickInputs,
      setHeldJoystickInputs: (next: ReadonlySet<string>) => {
        setHeldJoystickInputsState(next);
        setHeldJoystickInputsMock(next);
      },
      heldKeyboardInputs: new Set<string>(),
      setHeldKeyboardInputs: vi.fn(),
      autofireEnabled: false,
      setAutofireEnabled: vi.fn(),
      autofireRateHz: 10,
      setAutofireRateHz: vi.fn(),
      connectionStatus: "idle",
      sendChar: vi.fn(),
      sendKeyboardInputs: vi.fn(),
      sendCursor: vi.fn(),
      sendSpecialKey: vi.fn(),
      releaseAll: () => {
        setHeldJoystickInputsState(new Set());
        setReleaseAllEpoch((epoch) => epoch + 1);
      },
      releaseAllEpoch,
    };
  },
}));

import { RemoteInputSheet } from "@/components/remoteInput/RemoteInputSheet";
import { requestGameMode } from "@/lib/remoteInput/gameModeLaunch";
import { resetInputModality, setInputModality } from "@/lib/input/inputModality";
import { saveGameModeJoystick } from "@/lib/remoteInput/gameModeJoystick";
import { CONTROLS_HIDE_MS } from "@/components/streams/AvMirrorImmersive";

const enterGameMode = () => fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));
const sheet = () => screen.getByTestId("remote-input-sheet");
const joystick = () => screen.queryByTestId("remote-input-virtual-joystick");

/** Steer the game with a physical key — Classic T9's `4` is left at rest. */
const steerWithAKey = () => fireEvent.keyDown(sheet(), { code: "Numpad4", key: "4" });

/** The controls hide on a delay, so the assertion has to let that delay pass. */
const settleControlSurface = () =>
  act(() => {
    vi.advanceTimersByTime(CONTROLS_HIDE_MS + 10);
  });

/**
 * Bring the Game Mode toolbar back. It auto-hides the moment Game Mode is entered, and
 * stays up for six idle seconds once summoned — so a second call inside that window
 * finds no handle to press, and there is nothing to do.
 */
const summonChrome = () => {
  const handle = screen.queryByTestId("remote-input-restore-chrome");
  if (handle) fireEvent.click(handle);
};

describe("RemoteInputSheet — Game Mode", () => {
  beforeEach(() => {
    localStorage.clear();
    resetInputModality();
    tierState.tier = "full";
    tierState.resolved = true;
    mirrorState.videoState = "off";
    mirrorState.audioLive = false;
    mirrorState.stopVideo.mockClear();
    mirrorState.stopAudio.mockClear();
    setHeldJoystickInputsMock.mockClear();
    setOutputModeMock.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GM-1 / GM-3: a launch request opens the sheet in the playing state", () => {
    it("opens joystick + game mode when a request arrives while the sheet is closed", () => {
      const onOpenChange = vi.fn();
      render(<RemoteInputSheet open={false} onOpenChange={onOpenChange} />);

      act(() => requestGameMode({ startedVideo: true, startedAudio: true }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it("enters game mode when a request arrives while the sheet is already open", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      expect(screen.getByTestId("remote-input-mode-joystick")).toBeInTheDocument();

      act(() => requestGameMode({ startedVideo: false, startedAudio: false }));
      expect(screen.getByTestId("remote-input-restore-chrome")).toBeInTheDocument();
    });

    it("stops only the streams the launch started when the sheet closes", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      act(() => requestGameMode({ startedVideo: true, startedAudio: false }));

      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(mirrorState.stopVideo).toHaveBeenCalledTimes(1);
      expect(mirrorState.stopAudio).not.toHaveBeenCalled();
    });

    it("stops nothing when the launch found both feeds already running", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      act(() => requestGameMode({ startedVideo: false, startedAudio: false }));

      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(mirrorState.stopVideo).not.toHaveBeenCalled();
      expect(mirrorState.stopAudio).not.toHaveBeenCalled();
    });

    it("leaves the streams alone when game mode is exited without closing the sheet", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      act(() => requestGameMode({ startedVideo: true, startedAudio: true }));

      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));

      expect(mirrorState.stopVideo).not.toHaveBeenCalled();
      expect(mirrorState.stopAudio).not.toHaveBeenCalled();
    });
  });

  /**
   * The reported defect: Game Mode showed the on-screen joystick, then took it away a
   * couple of seconds later on a touchscreen, with the user having done nothing but
   * tap. The cause was reading the app-wide input modality, which ordinary keypad
   * navigation sets ANYWHERE in the app — including the `0` key that opens Game Mode.
   *
   * Hiding it now has exactly three triggers, and each is covered below: a physical
   * key that steered the game, the toolbar CTA, and the setting.
   */
  describe("GM-6: the joystick goes away only when something asked for it", () => {
    it("keeps the controls when the app-wide modality is already key-navigation on arrival", () => {
      mirrorState.videoState = "live";
      act(() => setInputModality("key-navigation"));
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      settleControlSurface();

      expect(joystick()).toBeInTheDocument();
      expect(sheet()).toHaveAttribute("data-joystick", "visible");
    });

    it("keeps them through a key that adjusts the view rather than steering the game", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();

      // `*` flips the mirror into Adjust; it never reaches the C64 as a joystick input.
      fireEvent.keyDown(sheet(), { code: "NumpadMultiply", key: "*" });
      settleControlSurface();

      expect(joystick()).toBeInTheDocument();
    });

    it("GM-6a: hides them once a physical key has steered the game", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      expect(joystick()).toBeInTheDocument();

      steerWithAKey();
      settleControlSurface();

      expect(joystick()).not.toBeInTheDocument();
      expect(screen.getByTestId("av-mirror-immersive")).toBeInTheDocument();
    });

    it("brings them back when the user touches them before the delay runs out", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      steerWithAKey();

      fireEvent.pointerDown(screen.getByTestId("remote-input-virtual-joystick"));
      settleControlSurface();

      expect(joystick()).toBeInTheDocument();
    });

    it("shows them with the picture off, whatever else says otherwise", () => {
      mirrorState.videoState = "off";
      saveGameModeJoystick("hidden");
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      steerWithAKey();
      settleControlSurface();

      expect(screen.queryByTestId("av-mirror-immersive")).not.toBeInTheDocument();
      expect(joystick()).toBeInTheDocument();
    });

    it("hides it from the start when the setting says hidden", () => {
      mirrorState.videoState = "live";
      saveGameModeJoystick("hidden");
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();

      // No delay: the user has already answered this question in Settings.
      expect(joystick()).not.toBeInTheDocument();
    });

    it("keeps it through a whole game played on the keys when the setting says visible", () => {
      mirrorState.videoState = "live";
      saveGameModeJoystick("visible");
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      steerWithAKey();
      settleControlSurface();

      expect(joystick()).toBeInTheDocument();
    });

    it("leaves the ordinary sheet's controls alone, keys or no keys", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      steerWithAKey();
      settleControlSurface();

      expect(joystick()).toBeInTheDocument();
    });
  });

  describe("GM-6b: the joystick toggle on the Game Mode toolbar", () => {
    it("hides it at once when asked, without waiting out the hide delay", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      summonChrome();

      fireEvent.click(screen.getByTestId("remote-input-joystick-visibility-toggle"));

      expect(joystick()).not.toBeInTheDocument();
      expect(sheet()).toHaveAttribute("data-joystick", "hidden");
    });

    it("brings it back, and outranks the setting that took it away", () => {
      mirrorState.videoState = "live";
      saveGameModeJoystick("hidden");
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      summonChrome();
      expect(joystick()).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("remote-input-joystick-visibility-toggle"));

      expect(joystick()).toBeInTheDocument();
    });

    it("keeps them once asked for, even after a physical key steers the game", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      summonChrome();
      fireEvent.click(screen.getByTestId("remote-input-joystick-visibility-toggle"));
      summonChrome();
      fireEvent.click(screen.getByTestId("remote-input-joystick-visibility-toggle"));

      steerWithAKey();
      settleControlSurface();

      expect(joystick()).toBeInTheDocument();
    });

    /**
     * The toggle has to describe the screen, not the rule. Hiding is delayed while the rule is
     * guessing, so in that window the joystick is still there — and a button reading "Show
     * joystick", reporting itself pressed, would be offering to produce something already visible.
     */
    it("still offers to hide the joystick during the delay, while it is still on screen", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      steerWithAKey();
      summonChrome();

      // Mid-delay: the rule has decided, the joystick has not gone yet.
      expect(joystick()).toBeInTheDocument();
      const toggle = screen.getByTestId("remote-input-joystick-visibility-toggle");
      expect(toggle).toHaveTextContent("Hide joystick");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(sheet()).toHaveAttribute("data-joystick", "visible");

      settleControlSurface();
      expect(joystick()).not.toBeInTheDocument();
      expect(screen.getByTestId("remote-input-joystick-visibility-toggle")).toHaveTextContent("Show joystick");
      expect(sheet()).toHaveAttribute("data-joystick", "hidden");
    });

    it("is not offered with the picture off, where there is nothing to give the space to", () => {
      mirrorState.videoState = "off";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      summonChrome();

      expect(screen.queryByTestId("remote-input-joystick-visibility-toggle")).not.toBeInTheDocument();
    });

    it("starts the next Game Mode session with nothing asked for and no keys used", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      summonChrome();
      fireEvent.click(screen.getByTestId("remote-input-joystick-visibility-toggle"));
      expect(joystick()).not.toBeInTheDocument();

      summonChrome();
      fireEvent.click(screen.getByTestId("remote-input-immersive-toggle"));
      enterGameMode();
      settleControlSurface();

      expect(joystick()).toBeInTheDocument();
    });
  });

  describe("GM-9: a rotation change re-derives the held set", () => {
    it("releases the old input and asserts the new one in one update", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      // Classic T9 (the general edition's default): `4` is left at rest.
      fireEvent.keyDown(sheet(), { code: "Numpad4", key: "4" });
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["left"]));
      setHeldJoystickInputsMock.mockClear();

      fireEvent.click(screen.getByTestId("remote-input-rotation-90"));

      expect(setHeldJoystickInputsMock).toHaveBeenCalledTimes(1);
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set(["up"]));
    });

    it("releases the direction on the key-up that follows the rotation", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      fireEvent.keyDown(sheet(), { code: "Numpad4", key: "4" });
      fireEvent.click(screen.getByTestId("remote-input-rotation-90"));
      setHeldJoystickInputsMock.mockClear();

      fireEvent.keyUp(sheet(), { code: "Numpad4", key: "4" });
      expect(setHeldJoystickInputsMock).toHaveBeenLastCalledWith(new Set());
    });

    it("does not touch the transport when nothing is held", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      setHeldJoystickInputsMock.mockClear();

      fireEvent.click(screen.getByTestId("remote-input-rotation-90"));
      expect(setHeldJoystickInputsMock).not.toHaveBeenCalled();
    });
  });

  /**
   * The two shipped defaults, driven the way a handset drives them.
   *
   * Events are built as ANDROID sends them, not as a desktop keyboard does: measured on a Pixel 4,
   * the WebView delivers a keypad digit with an EMPTY `code` and the DOM key code, and the D-pad's
   * centre as `Enter`/13 rather than anything named `DpadCenter`. Tests written with `code:
   * "Numpad4"` exercise a shape the target hardware never produces, which is how a binding that
   * could not match on device passed every unit test it had.
   *
   * `tools/hil/joystick_rotation_hil.mjs` asserts the same two tables against a real C64.
   */
  describe("GM-8: the shipped layouts, as a handset delivers them", () => {
    const androidDigit = (digit: number) => ({ code: "", key: String(digit), keyCode: 48 + digit });
    const ANDROID_DPAD_CENTRE = { code: "", key: "Enter", keyCode: 13 };

    const openAt = (layout: string) => {
      localStorage.setItem("c64u_remote_input_joystick_layout", layout);
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
    };

    const press = (event: Record<string, unknown>) => {
      setHeldJoystickInputsMock.mockClear();
      fireEvent.keyDown(sheet(), event);
      const held = setHeldJoystickInputsMock.mock.lastCall?.[0] as ReadonlySet<string> | undefined;
      fireEvent.keyUp(sheet(), event);
      return [...(held ?? new Set())].sort();
    };

    it("steers the 8-centred diamond from the four keys around 8, with 8 as fire", () => {
      openAt("diamond8");
      expect(press(androidDigit(5))).toEqual(["up"]);
      expect(press(androidDigit(0))).toEqual(["down"]);
      expect(press(androidDigit(7))).toEqual(["left"]);
      expect(press(androidDigit(9))).toEqual(["right"]);
      expect(press(androidDigit(8))).toEqual(["fire"]);
    });

    it("steers Classic T9 from 2/4/6/8 with 5 as fire", () => {
      openAt("classicT9");
      expect(press(androidDigit(2))).toEqual(["up"]);
      expect(press(androidDigit(8))).toEqual(["down"]);
      expect(press(androidDigit(4))).toEqual(["left"]);
      expect(press(androidDigit(6))).toEqual(["right"]);
      expect(press(androidDigit(5))).toEqual(["fire"]);
    });

    it("gives 8 opposite meanings under the two layouts, which is the whole point of choosing", () => {
      openAt("diamond8");
      expect(press(androidDigit(8))).toEqual(["fire"]);
      cleanup();
      openAt("classicT9");
      expect(press(androidDigit(8))).toEqual(["down"]);
    });

    it("fires from the D-pad centre in both layouts, however the WebView reports it", () => {
      for (const layout of ["diamond8", "classicT9"]) {
        openAt(layout);
        expect(press(ANDROID_DPAD_CENTRE)).toEqual(["fire"]);
        cleanup();
      }
    });

    it("turns the diamond with the handset, so 0 steers right once it is held sideways", () => {
      openAt("diamond8");
      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      fireEvent.click(screen.getByTestId("remote-input-rotation-270"));
      // 0 is DOWN in portrait; turned anticlockwise it points right.
      expect(press(androidDigit(0))).toEqual(["right"]);
      expect(press(androidDigit(5))).toEqual(["left"]);
      expect(press(androidDigit(8))).toEqual(["fire"]);
    });
  });

  describe("GM-11: the picture turns, and only the picture", () => {
    it("counter-rotates the mirror by the pinned angle", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-rotation", "0");

      fireEvent.click(screen.getByTestId("remote-input-rotation-270"));
      expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-rotation", "270");
    });

    it("goes back to the sensor when Auto is chosen again", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      fireEvent.click(screen.getByTestId("remote-input-restore-chrome"));
      fireEvent.click(screen.getByTestId("remote-input-rotation-90"));
      fireEvent.click(screen.getByTestId("remote-input-rotation-auto"));

      expect(screen.getByTestId("remote-input-rotation-override")).toHaveAttribute("data-source", "auto");
      expect(screen.getByTestId("av-mirror-immersive")).toHaveAttribute("data-rotation", "0");
    });
  });

  describe("GM-14: reaching everything with the controls hidden", () => {
    it("`#` shows the quick keys and the Live View switches over the picture", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      expect(screen.queryByTestId("remote-input-quick-keys-toggle")).not.toBeInTheDocument();

      fireEvent.keyDown(sheet(), { code: "Pound", key: "#" });
      const overlay = screen.getByTestId("remote-input-quick-keys-toggle");
      expect(overlay).toBeInTheDocument();
      expect(overlay.querySelector('[data-testid="av-video-toggle"]')).not.toBeNull();
      expect(overlay.querySelector('[data-testid="av-audio-toggle"]')).not.toBeNull();
    });

    it("`#` puts the row away again", () => {
      mirrorState.videoState = "live";
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();

      fireEvent.keyDown(sheet(), { code: "Pound", key: "#" });
      expect(screen.getByTestId("remote-input-quick-keys-toggle")).toBeInTheDocument();
      fireEvent.keyDown(sheet(), { code: "Pound", key: "#" });
      expect(screen.queryByTestId("remote-input-quick-keys-toggle")).not.toBeInTheDocument();
    });

    it("leaves `#` inert outside game mode, where the quick keys are already on screen", () => {
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      fireEvent.keyDown(sheet(), { code: "Pound", key: "#" });
      expect(screen.queryByTestId("remote-input-quick-keys-toggle")).not.toBeInTheDocument();
    });
  });

  describe("tier downgrade", () => {
    // A request that cannot be honoured must not leave a stripped header with no control
    // on it. Seen on hardware: the probe had not resolved, so nothing switched the sheet
    // to Keys and nothing cancelled the request — and the sheet showed the "Game mode"
    // label with neither the mode toggle nor an Exit button on it.
    it("keeps the ordinary chrome, and its way out, when the relay is unavailable", () => {
      tierState.tier = "kernal-fallback";
      tierState.resolved = false;
      render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      act(() => requestGameMode({ startedVideo: false, startedAudio: false }));

      expect(screen.getByTestId("remote-input-sheet")).toHaveAttribute("data-game-mode", "false");
      expect(screen.getByTestId("remote-input-output-mode-toggle")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-panic-button")).toBeInTheDocument();
      expect(screen.getByTestId("remote-input-close")).toBeInTheDocument();
      expect(screen.queryByTestId("remote-input-restore-chrome")).not.toBeInTheDocument();
    });

    it("drops out of game mode when the joystick relay becomes unavailable", () => {
      const { rerender } = render(<RemoteInputSheet open onOpenChange={vi.fn()} />);
      enterGameMode();
      expect(screen.getByTestId("remote-input-restore-chrome")).toBeInTheDocument();

      tierState.tier = "kernal-fallback";
      rerender(<RemoteInputSheet open onOpenChange={vi.fn()} />);

      expect(screen.queryByTestId("remote-input-restore-chrome")).not.toBeInTheDocument();
    });
  });
});
