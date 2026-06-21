import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { requestDiagnosticsOpen, requestDeviceSwitcherOpen, devices } = vi.hoisted(() => ({
  requestDiagnosticsOpen: vi.fn(),
  requestDeviceSwitcherOpen: vi.fn(),
  devices: vi.fn(() => ({ devices: [{ id: "a" }, { id: "b" }] })),
}));
vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({ requestDiagnosticsOpen }));
vi.mock("@/lib/input/keypadCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/input/keypadCommands")>()),
  requestDeviceSwitcherOpen,
}));
vi.mock("@/hooks/useSavedDevices", () => ({ useSavedDevices: () => devices() }));

import { KeypadQuickMenu } from "@/components/input/KeypadQuickMenu";
import { requestQuickMenuOpen } from "@/lib/input/keypadCommands";

const renderMenu = () =>
  render(
    <MemoryRouter>
      <KeypadQuickMenu />
    </MemoryRouter>,
  );

describe("KeypadQuickMenu", () => {
  beforeEach(() => devices.mockReturnValue({ devices: [{ id: "a" }, { id: "b" }] }));
  afterEach(() => vi.clearAllMocks());

  it("opens on the quick-menu command and lists page jumps, Diagnostics, and Switch device", async () => {
    renderMenu();
    expect(screen.queryByTestId("keypad-quick-menu")).toBeNull();

    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());

    expect(screen.getByTestId("keypad-quick-menu-tab-home")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-quick-menu-tab-docs")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-quick-menu-diagnostics")).toBeInTheDocument();
    expect(screen.getByTestId("keypad-quick-menu-switch-device")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("keypad-quick-menu-diagnostics"));
    expect(requestDiagnosticsOpen).toHaveBeenCalledWith("header");
  });

  it("invokes the device switcher and a page jump", async () => {
    renderMenu();
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("keypad-quick-menu-switch-device"));
    expect(requestDeviceSwitcherOpen).toHaveBeenCalledTimes(1);

    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
    // A page jump closes the menu without throwing.
    fireEvent.click(screen.getByTestId("keypad-quick-menu-tab-play"));
    await waitFor(() => expect(screen.queryByTestId("keypad-quick-menu")).toBeNull());
  });

  it("hides Switch device when only one device is saved", async () => {
    devices.mockReturnValue({ devices: [{ id: "only" }] });
    renderMenu();
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
    expect(screen.queryByTestId("keypad-quick-menu-switch-device")).toBeNull();
  });
});
