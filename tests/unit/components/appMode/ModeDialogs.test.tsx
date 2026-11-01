/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

const transitions = vi.hoisted(() => ({
  enterSidPlayer: vi.fn(async () => undefined),
  switchToFullApp: vi.fn(async () => undefined),
  switchToDemoMode: vi.fn(async () => undefined),
}));
vi.mock("@/lib/appMode/appModeTransitions", () => transitions);
vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => ({ state: "OFFLINE_NO_DEMO" }) }));
const diagnostics = vi.hoisted(() => ({ requestDiagnosticsOpen: vi.fn() }));
vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => diagnostics);
const profile = vi.hoisted(() => ({ value: "medium" }));
vi.mock("@/hooks/useDisplayProfile", () => ({ useDisplayProfile: () => ({ profile: profile.value }) }));

import { ModeDialogs } from "@/components/appMode/ModeDialogs";
import { MODE_COPY } from "@/lib/appMode/copy";
import { requestModeDialog } from "@/lib/appMode/modeDialogRequests";

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;

const mount = (path = "/settings") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ModeDialogs />
      <Where />
    </MemoryRouter>,
  );

const open = (kind: "enter" | "leave" | "sheet") => act(() => requestModeDialog(kind));

describe("ModeDialogs", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    profile.value = "medium";
  });

  it("SPM-SWT-02 the Enter confirmation uses the specified words and nothing changes until it is confirmed", () => {
    mount();
    open("enter");

    expect(screen.getByTestId("mode-dialog-enter")).toHaveTextContent(MODE_COPY.enter.title);
    expect(screen.getByTestId("mode-dialog-enter-body")).toHaveTextContent(MODE_COPY.enter.body);
    expect(transitions.enterSidPlayer).not.toHaveBeenCalled();
  });

  it("SPM-SWT-02 confirming Enter switches the mode and opens Play", async () => {
    mount("/settings");
    open("enter");
    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-dialog-enter-confirm"));
    });

    expect(transitions.enterSidPlayer).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent("/play");
    expect(screen.queryByTestId("mode-dialog-enter")).toBeNull();
  });

  it("SPM-SWT-02 the Enter dialog says it is switching while the device is let go of, and takes no second press", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(transitions.enterSidPlayer).mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    mount("/settings");
    open("enter");
    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-dialog-enter-confirm"));
    });

    expect(screen.getByTestId("mode-dialog-enter-confirm")).toHaveTextContent(MODE_COPY.enter.switching);
    expect(screen.getByTestId("mode-dialog-enter-confirm")).toBeDisabled();
    expect(screen.getByTestId("mode-dialog-cancel")).toBeDisabled();
    fireEvent.click(screen.getByTestId("mode-dialog-enter-confirm"));
    expect(transitions.enterSidPlayer).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(screen.queryByTestId("mode-dialog-enter")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent("/play");
  });

  it("SPM-SWT-02 cancel changes nothing", () => {
    mount();
    open("enter");
    fireEvent.click(screen.getByTestId("mode-dialog-cancel"));

    expect(transitions.enterSidPlayer).not.toHaveBeenCalled();
    expect(screen.getByTestId("where")).toHaveTextContent("/settings");
    expect(screen.queryByTestId("mode-dialog-enter")).toBeNull();
  });

  it("SPM-SWT-02 Back (Escape) cancels the Leave confirmation", () => {
    mount();
    open("leave");
    fireEvent.keyDown(screen.getByTestId("mode-dialog-leave"), { key: "Escape" });

    expect(transitions.switchToFullApp).not.toHaveBeenCalled();
    expect(transitions.switchToDemoMode).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mode-dialog-leave")).toBeNull();
  });

  it("SPM-SWT-02 leaving to the Full App and to Demo Mode run their own transitions", async () => {
    mount();
    open("leave");
    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-dialog-leave-full-app"));
    });
    expect(transitions.switchToFullApp).toHaveBeenCalledTimes(1);

    open("leave");
    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-dialog-leave-demo-mode"));
    });
    expect(transitions.switchToDemoMode).toHaveBeenCalledTimes(1);
  });

  it("SPM-SWT-02 the compact profile shows the two-line bodies", () => {
    profile.value = "compact";
    mount();
    open("enter");
    expect(screen.getByTestId("mode-dialog-enter-body")).toHaveTextContent(MODE_COPY.enter.compactBody);
    fireEvent.click(screen.getByTestId("mode-dialog-cancel"));
    open("leave");
    expect(screen.getByTestId("mode-dialog-leave-body")).toHaveTextContent(MODE_COPY.leave.compactBody);
  });

  it("SPM-ERR-02 the mode sheet names SID Player, offers the three choices and a Diagnostics link", () => {
    mount();
    open("sheet");

    const sheet = screen.getByTestId("mode-sheet");
    expect(sheet).toHaveTextContent(MODE_COPY.sheet.title);
    expect(sheet).toHaveTextContent(MODE_COPY.sheet.body);
    expect(screen.getAllByTestId(/^device-less-choice-/)).toHaveLength(3);
    fireEvent.click(screen.getByTestId("mode-sheet-diagnostics"));
    expect(diagnostics.requestDiagnosticsOpen).toHaveBeenCalledWith("header");
    expect(screen.queryByTestId("mode-sheet")).toBeNull();
  });
});
