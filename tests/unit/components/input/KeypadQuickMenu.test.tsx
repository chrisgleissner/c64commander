import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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

const variantId = vi.hoisted(() => ({ current: "c64commander" }));
vi.mock("@/generated/variant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/generated/variant")>();
  return {
    ...actual,
    get variant() {
      return { ...actual.variant, id: variantId.current };
    },
  };
});

import { KeypadQuickMenu } from "@/components/input/KeypadQuickMenu";
import { requestQuickMenuOpen, subscribeMachineCommand, type MachineCommand } from "@/lib/input/keypadCommands";

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

  it("carries the two machine actions, and names the key that reaches each without the menu", async () => {
    const seen: MachineCommand[] = [];
    const unsubscribe = subscribeMachineCommand((command) => seen.push(command));
    renderMenu();

    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
    expect(screen.getByTestId("keypad-quick-menu-machine-pause").textContent).toContain("8");
    expect(screen.getByTestId("keypad-quick-menu-machine-reset").textContent).toContain("9");

    fireEvent.click(screen.getByTestId("keypad-quick-menu-machine-pause"));
    await waitFor(() => expect(screen.queryByTestId("keypad-quick-menu")).toBeNull());

    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("keypad-quick-menu-machine-reset"));
    await waitFor(() => expect(seen).toEqual(["pauseResume", "reset"]));

    unsubscribe();
  });

  it("leaves the machine actions out of the menu a pointer user opens, who has the grid in front of them", async () => {
    renderMenu();

    requestQuickMenuOpen("pointer");
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());

    expect(screen.queryByTestId("keypad-quick-menu-machine-pause")).toBeNull();
    expect(screen.queryByTestId("keypad-quick-menu-machine-reset")).toBeNull();
  });

  it("hides Switch device when only one device is saved", async () => {
    devices.mockReturnValue({ devices: [{ id: "only" }] });
    renderMenu();
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
    expect(screen.queryByTestId("keypad-quick-menu-switch-device")).toBeNull();
  });
});

describe("KeypadQuickMenu function-key summary", () => {
  const F1_KEY = "c64u_remote_function_1_action";
  const F3_KEY = "c64u_remote_function_3_action";

  const announce = (key: string) =>
    act(() => {
      window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key } }));
    });

  const openMenu = async () => {
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
  };

  beforeEach(() => {
    localStorage.clear();
    variantId.current = "c64u-remote";
    devices.mockReturnValue({ devices: [{ id: "a" }] });
  });
  afterEach(() => {
    variantId.current = "c64commander";
    vi.clearAllMocks();
  });

  it("names the default F1 and F3 assignments on C64U Remote", async () => {
    renderMenu();
    await openMenu();

    expect(screen.getByTestId("keypad-quick-menu-function-summary")).toHaveTextContent(
      "F1: Play/Pause · F3: Next tune",
    );
  });

  it("follows a change to either function-key assignment and ignores unrelated settings", async () => {
    renderMenu();

    localStorage.setItem(F1_KEY, "search");
    announce("c64u_debug_logging_enabled");
    await openMenu();
    expect(screen.getByTestId("keypad-quick-menu-function-summary")).toHaveTextContent("F1: Play/Pause");

    localStorage.setItem(F3_KEY, "gameMode");
    announce(F3_KEY);
    expect(screen.getByTestId("keypad-quick-menu-function-summary")).toHaveTextContent("F1: Search · F3: Game Mode");

    localStorage.setItem(F1_KEY, "unassigned");
    announce(F1_KEY);
    expect(screen.getByTestId("keypad-quick-menu-function-summary")).toHaveTextContent("F1: Unassigned");
  });

  it("lands Configure on the F1 assignment in the function-key card, not the top of Settings", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<div data-testid="home-route" />} />
          <Route
            path="/settings"
            element={
              <div data-testid="settings-route">
                <button type="button">Unrelated first control</button>
                <section data-section-scope="settings" data-section-id="play-and-disk">
                  <div data-testid="settings-remote-function-actions">
                    <button type="button" data-testid="settings-remote-function-1">
                      F1 assignment
                    </button>
                  </div>
                </section>
              </div>
            }
          />
        </Routes>
        <KeypadQuickMenu />
      </MemoryRouter>,
    );
    await openMenu();

    fireEvent.click(screen.getByTestId("keypad-quick-menu-configure-function-keys"));

    await waitFor(() => expect(screen.queryByTestId("keypad-quick-menu")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("settings-remote-function-1")).toHaveFocus());
    expect(screen.getByTestId("settings-remote-function-actions")).toHaveAttribute("data-search-landed", "true");
  });

  it("has no function-key summary in C64 Commander", async () => {
    variantId.current = "c64commander";
    renderMenu();
    await openMenu();

    expect(screen.queryByTestId("keypad-quick-menu-function-summary")).toBeNull();
  });
});
