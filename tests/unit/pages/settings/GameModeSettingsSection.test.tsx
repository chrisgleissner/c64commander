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
import { loadGameModeJoystick, saveGameModeJoystick } from "@/lib/remoteInput/gameModeJoystick";
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
    expect(loadGameModeJoystick()).toBe("auto");
    render(<GameModeSettingsSection />);
    expect(screen.getByTestId("settings-joystick-key-layout")).toHaveTextContent("Classic T9");
    expect(screen.getByTestId("settings-game-mode-joystick")).toHaveTextContent("Auto");
  });
});

/**
 * The layout picker is the control that makes the assignment configurable, and it is the one
 * route by which a user reaches the 8-centred diamond on an edition that does not ship it as
 * the default. Asserted through the select rather than through `saveJoystickLayout`, because
 * writing storage proves nothing about whether anybody can reach it.
 */
describe("choosing between the shipped layouts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const chooseLayout = async (label: string) => {
    fireEvent.click(screen.getByTestId("settings-joystick-key-layout"));
    const option = await screen.findByRole("option", { name: label });
    fireEvent.click(option);
  };

  it("offers both defaults and Custom, named the way the manual names them", () => {
    render(<GameModeSettingsSection />);
    fireEvent.click(screen.getByTestId("settings-joystick-key-layout"));
    expect(screen.getByRole("option", { name: "Diamond (8-centred)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Classic T9" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Custom" })).toBeInTheDocument();
  });

  it("stores the 8-centred diamond when it is chosen", async () => {
    render(<GameModeSettingsSection />);
    await chooseLayout("Diamond (8-centred)");
    expect(loadJoystickLayout()).toBe("diamond8");
  });

  it("switches back to Classic T9", async () => {
    saveJoystickLayout("diamond8");
    render(<GameModeSettingsSection />);
    await chooseLayout("Classic T9");
    expect(loadJoystickLayout()).toBe("classicT9");
  });

  it("says which keys each preset uses, so the choice can be made without trying it", () => {
    render(<GameModeSettingsSection />);
    const section = screen.getByTestId("settings-game-mode-section");
    expect(section).toHaveTextContent("the four keys around 8, with 8 as fire");
    expect(section).toHaveTextContent("2, 4, 6 and 8 with 5 as fire");
  });
});

/**
 * AC-5: "Add a setting to hide all on-screen keyboard and joystick controls in Remote
 * Input if set to Game mode." Asserted through the select, like the layout picker above —
 * writing storage with `saveGameModeJoystick` proves the persistence layer works but
 * nothing about whether the control that is supposed to reach it actually does.
 */
describe("choosing the on-screen joystick visibility setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const chooseVisibility = async (label: string) => {
    fireEvent.click(screen.getByTestId("settings-game-mode-joystick"));
    const option = await screen.findByRole("option", { name: label });
    fireEvent.click(option);
  };

  it("offers Auto, Visible and Hidden", () => {
    render(<GameModeSettingsSection />);
    fireEvent.click(screen.getByTestId("settings-game-mode-joystick"));
    expect(screen.getByRole("option", { name: "Auto" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Visible" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Hidden" })).toBeInTheDocument();
  });

  it("stores Hidden when it is chosen — the c64u-remote default, reachable by every variant", async () => {
    render(<GameModeSettingsSection />);
    await chooseVisibility("Hidden");
    expect(loadGameModeJoystick()).toBe("hidden");
    expect(screen.getByTestId("settings-game-mode-joystick")).toHaveTextContent("Hidden");
  });

  it("switches back to Visible", async () => {
    saveGameModeJoystick("hidden");
    render(<GameModeSettingsSection />);
    await chooseVisibility("Visible");
    expect(loadGameModeJoystick()).toBe("visible");
  });

  it("returns to Auto", async () => {
    saveGameModeJoystick("hidden");
    render(<GameModeSettingsSection />);
    await chooseVisibility("Auto");
    expect(loadGameModeJoystick()).toBe("auto");
  });
});
