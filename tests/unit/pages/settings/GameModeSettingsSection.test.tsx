/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { GameModeSettingsSection } from "@/pages/settings/GameModeSettingsSection";
import { loadCustomBinding, loadJoystickLayout, saveJoystickLayout } from "@/lib/remoteInput/joystickKeyBindings";
import { loadGameModeControls } from "@/lib/remoteInput/gameModeControlSurface";
import { loadGameModeOnLaunch } from "@/lib/remoteInput/gameModeLaunch";

describe("GameModeSettingsSection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the binding editor only for a custom layout", () => {
    render(<GameModeSettingsSection />);
    expect(screen.queryByTestId("settings-joystick-bindings")).not.toBeInTheDocument();

    saveJoystickLayout("custom");
    render(<GameModeSettingsSection />);
    expect(screen.getAllByTestId("settings-joystick-bindings").length).toBeGreaterThan(0);
  });

  // GM-15: press-to-bind is the only route that works on a handset with no
  // touchscreen, and the only one that is correct when the app cannot predict
  // what a key reports.
  it("captures the next physical key into the focused slot", () => {
    saveJoystickLayout("custom");
    render(<GameModeSettingsSection />);

    fireEvent.click(screen.getByTestId("settings-joystick-bind-up"));
    expect(screen.getByTestId("settings-joystick-bind-up")).toHaveTextContent("Press a key…");

    fireEvent.keyDown(window, { code: "Digit5", key: "5" });

    expect(loadCustomBinding()).toEqual({ up: "digit5" });
    expect(screen.getByTestId("settings-joystick-bind-up")).toHaveTextContent("5");
  });

  it("rejects a reserved action with a message naming what the key already does", () => {
    saveJoystickLayout("custom");
    render(<GameModeSettingsSection />);

    fireEvent.click(screen.getByTestId("settings-joystick-bind-fire"));
    fireEvent.keyDown(window, { key: "#" });

    expect(screen.getByTestId("settings-joystick-bind-rejection")).toHaveTextContent(
      /quick keys and the Live View switches/i,
    );
    expect(loadCustomBinding()).toEqual({});
    // Still capturing, so the user can simply press a different key.
    expect(screen.getByTestId("settings-joystick-bind-fire")).toHaveTextContent("Press a key…");
  });

  it("moves an action to its new slot rather than steering two directions at once", () => {
    saveJoystickLayout("custom");
    render(<GameModeSettingsSection />);

    fireEvent.click(screen.getByTestId("settings-joystick-bind-up"));
    fireEvent.keyDown(window, { code: "Digit5", key: "5" });
    fireEvent.click(screen.getByTestId("settings-joystick-bind-down"));
    fireEvent.keyDown(window, { code: "Digit5", key: "5" });

    expect(loadCustomBinding()).toEqual({ down: "digit5" });
  });

  it("clears a slot", () => {
    saveJoystickLayout("custom");
    render(<GameModeSettingsSection />);

    fireEvent.click(screen.getByTestId("settings-joystick-bind-left"));
    fireEvent.keyDown(window, { code: "Digit7", key: "7" });
    fireEvent.click(screen.getByTestId("settings-joystick-clear-left"));

    expect(loadCustomBinding()).toEqual({});
  });

  it("abandons capture on Back rather than binding it", () => {
    saveJoystickLayout("custom");
    render(<GameModeSettingsSection />);

    fireEvent.click(screen.getByTestId("settings-joystick-bind-up"));
    fireEvent.keyDown(window, { code: "GoBack" });

    expect(screen.getByTestId("settings-joystick-bind-up")).toHaveTextContent("Not set");
    expect(loadCustomBinding()).toEqual({});
  });

  it("persists the auto-enter switch", () => {
    render(<GameModeSettingsSection />);
    const before = loadGameModeOnLaunch();

    fireEvent.click(screen.getByTestId("settings-game-mode-on-launch"));
    expect(loadGameModeOnLaunch()).toBe(!before);
  });

  it("starts from the stored preferences", () => {
    expect(loadJoystickLayout()).toBe("classicT9");
    expect(loadGameModeControls()).toBe("auto");
    render(<GameModeSettingsSection />);
    expect(screen.getByTestId("settings-joystick-key-layout")).toHaveTextContent("Classic T9");
    expect(screen.getByTestId("settings-game-mode-controls")).toHaveTextContent("Auto");
  });
});
