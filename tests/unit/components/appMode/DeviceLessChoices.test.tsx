/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const transitions = vi.hoisted(() => ({
  switchToFullApp: vi.fn(async () => undefined),
  switchToDemoMode: vi.fn(async () => undefined),
}));
vi.mock("@/lib/appMode/appModeTransitions", () => transitions);

const connection = vi.hoisted(() => ({ state: "REAL_CONNECTED" }));
vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: connection.state }) }));

import { DeviceLessChoices } from "@/components/appMode/DeviceLessChoices";
import { saveStartupModeByUser } from "@/lib/appMode/appModeStore";
import { subscribeModeDialog, type ModeDialogKind } from "@/lib/appMode/modeDialogRequests";

describe("DeviceLessChoices", () => {
  const requests: ModeDialogKind[] = [];
  let unsubscribe = () => {};

  beforeEach(() => {
    localStorage.clear();
    saveStartupModeByUser("default");
    connection.state = "REAL_CONNECTED";
    requests.length = 0;
    transitions.switchToFullApp.mockClear();
    transitions.switchToDemoMode.mockClear();
    unsubscribe = subscribeModeDialog((kind) => requests.push(kind));
  });
  afterEach(() => {
    unsubscribe();
    saveStartupModeByUser("default");
  });

  const current = () =>
    screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("data-current") === "true")
      .map((button) => button.getAttribute("data-testid"));

  it("SPM-ARCH-06 marks the current mode", () => {
    const { rerender } = render(<DeviceLessChoices />);
    expect(current()).toEqual(["device-less-choice-full-app"]);

    connection.state = "DEMO_ACTIVE";
    rerender(<DeviceLessChoices />);
    expect(current()).toEqual(["device-less-choice-demo-mode"]);

    saveStartupModeByUser("sid-player");
    connection.state = "OFFLINE_NO_DEMO";
    rerender(<DeviceLessChoices />);
    expect(current()).toEqual(["device-less-choice-sid-player"]);
  });

  it("SPM-ARCH-06 choosing SID Player asks for confirmation before switching", () => {
    const onChosen = vi.fn();
    render(<DeviceLessChoices onChosen={onChosen} />);
    fireEvent.click(screen.getByTestId("device-less-choice-sid-player"));

    expect(requests).toEqual(["enter"]);
    expect(onChosen).toHaveBeenCalledTimes(1);
    expect(transitions.switchToFullApp).not.toHaveBeenCalled();
    expect(transitions.switchToDemoMode).not.toHaveBeenCalled();
  });

  it("SPM-SWT-02 choosing Demo Mode from SID Player asks before leaving", () => {
    saveStartupModeByUser("sid-player");
    connection.state = "OFFLINE_NO_DEMO";
    render(<DeviceLessChoices />);
    fireEvent.click(screen.getByTestId("device-less-choice-demo-mode"));

    expect(transitions.switchToDemoMode).not.toHaveBeenCalled();
    expect(requests).toEqual(["leave"]);
  });

  it("SPM-SWT-02 choosing Full App from SID Player asks before leaving", () => {
    saveStartupModeByUser("sid-player");
    render(<DeviceLessChoices />);
    fireEvent.click(screen.getByTestId("device-less-choice-full-app"));

    expect(transitions.switchToFullApp).not.toHaveBeenCalled();
    expect(requests).toEqual(["leave"]);
  });

  it("SPM-ARCH-06 choosing the current mode does nothing", () => {
    render(<DeviceLessChoices />);
    fireEvent.click(screen.getByTestId("device-less-choice-full-app"));

    expect(transitions.switchToFullApp).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it("SPM-ARCH-06 every choice is a button in the tab order and at least 44 px tall", () => {
    render(<DeviceLessChoices />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      expect(button.className).toMatch(/min-h-11/);
    }
  });
});
