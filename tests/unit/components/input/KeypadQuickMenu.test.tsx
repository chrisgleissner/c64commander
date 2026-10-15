import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { requestDiagnosticsOpen, requestDeviceSwitcherOpen, devices, toast } = vi.hoisted(() => ({
  requestDiagnosticsOpen: vi.fn(),
  toast: vi.fn(),
  requestDeviceSwitcherOpen: vi.fn(),
  devices: vi.fn(() => ({ devices: [{ id: "a" }, { id: "b" }] })),
}));
vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({ requestDiagnosticsOpen }));
vi.mock("@/lib/input/keypadCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/input/keypadCommands")>()),
  requestDeviceSwitcherOpen,
}));
vi.mock("@/hooks/useSavedDevices", () => ({ useSavedDevices: () => devices() }));
vi.mock("@/hooks/use-toast", () => ({ toast }));

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

  it("offers the newest notification's action, so a keypad can press Retry", async () => {
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <div data-testid="app-toast" data-state="open">
          <div data-testid="app-toast-action">
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        </div>
        <KeypadQuickMenu />
      </MemoryRouter>,
    );

    requestQuickMenuOpen();
    const entry = await screen.findByTestId("keypad-quick-menu-toast-action");
    expect(entry).toHaveTextContent("Notification: Retry");

    fireEvent.click(entry);
    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("keypad-quick-menu")).toBeNull());
  });

  it("says the action did not run when its notification closed while the menu was open", async () => {
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <div data-testid="app-toast" data-state="open">
          <div data-testid="app-toast-action">
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        </div>
        <KeypadQuickMenu />
      </MemoryRouter>,
    );

    requestQuickMenuOpen();
    const entry = await screen.findByTestId("keypad-quick-menu-toast-action");
    screen.getByText("Retry").closest('[data-testid="app-toast"]')!.setAttribute("data-state", "closed");
    fireEvent.click(entry);

    expect(retry).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Notification already closed" }));
  });

  it("offers no notification entry when the newest notification has no action", async () => {
    render(
      <MemoryRouter>
        <div data-testid="app-toast" data-state="open">
          Saved
        </div>
        <div data-testid="app-toast" data-state="open">
          <div data-testid="app-toast-action">
            <button type="button">Retry</button>
          </div>
        </div>
        <KeypadQuickMenu />
      </MemoryRouter>,
    );

    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
    expect(screen.queryByTestId("keypad-quick-menu-toast-action")).toBeNull();
  });

  it("lists no notification entry when no open notification has an action", async () => {
    renderMenu();
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument());
    expect(screen.queryByTestId("keypad-quick-menu-toast-action")).toBeNull();
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

  it("presses the entry whose keycap matches a key pressed while the menu is open", async () => {
    const seen: MachineCommand[] = [];
    const unsubscribe = subscribeMachineCommand((command) => seen.push(command));
    renderMenu();

    requestQuickMenuOpen();
    const menu = await screen.findByTestId("keypad-quick-menu");
    fireEvent.keyDown(menu, { key: "*" });
    expect(requestDiagnosticsOpen).toHaveBeenCalledWith("header");
    await waitFor(() => expect(screen.queryByTestId("keypad-quick-menu")).toBeNull());

    requestQuickMenuOpen();
    fireEvent.keyDown(await screen.findByTestId("keypad-quick-menu"), { key: "8" });
    await waitFor(() => expect(seen).toEqual(["pauseResume"]));

    requestQuickMenuOpen();
    fireEvent.keyDown(await screen.findByTestId("keypad-quick-menu"), { key: "#" });
    expect(requestDeviceSwitcherOpen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores a held key and a key that names no entry", async () => {
    renderMenu();
    requestQuickMenuOpen();
    const menu = await screen.findByTestId("keypad-quick-menu");

    fireEvent.keyDown(menu, { key: "*", repeat: true });
    fireEvent.keyDown(menu, { key: "x" });

    expect(requestDiagnosticsOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("keypad-quick-menu")).toBeInTheDocument();
  });

  it("gives the keycaps no keys in the menu a pointer user opens, where no keycaps are drawn", async () => {
    renderMenu();
    requestQuickMenuOpen("pointer");
    fireEvent.keyDown(await screen.findByTestId("keypad-quick-menu"), { key: "*" });

    expect(requestDiagnosticsOpen).not.toHaveBeenCalled();
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

  it("says so when Configure cannot find the function-key card on Settings", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<div data-testid="home-route" />} />
          <Route path="/settings" element={<div data-testid="settings-route" />} />
        </Routes>
        <KeypadQuickMenu />
      </MemoryRouter>,
    );
    await openMenu();

    fireEvent.click(screen.getByTestId("keypad-quick-menu-configure-function-keys"));

    await waitFor(() => expect(screen.getByTestId("settings-route")).toBeInTheDocument());
    await waitFor(
      () =>
        expect(toast).toHaveBeenCalledWith({ title: "Could not reach Remote function keys", variant: "destructive" }),
      { timeout: 5000 },
    );
  });

  it("lists the function-key summary last, after the entries it scrolls with", async () => {
    renderMenu();
    await openMenu();

    const summary = screen.getByTestId("keypad-quick-menu-function-summary");
    const entries = screen.getByTestId("keypad-quick-menu-search").parentElement;
    expect(entries).toHaveClass("overflow-y-auto");
    expect(summary.parentElement).toBe(entries);
    expect(entries?.lastElementChild).toBe(summary);
    expect(entries?.firstElementChild).not.toBe(summary);
  });

  it("has no function-key summary in C64 Commander", async () => {
    variantId.current = "c64commander";
    renderMenu();
    await openMenu();

    expect(screen.queryByTestId("keypad-quick-menu-function-summary")).toBeNull();
  });

  it("counts only the cards of the page on screen, not those of pages kept hidden", async () => {
    const pages = document.createElement("div");
    pages.innerHTML = `
      <div data-slot-active="false" data-slot-cached="true">
        <section data-section-label="Hidden A" data-open="false"></section>
        <section data-section-label="Hidden B" data-open="false"></section>
      </div>
      <div data-slot-active="true">
        <section data-section-label="Shown" data-open="true"></section>
      </div>`;
    document.body.appendChild(pages);
    try {
      renderMenu();
      requestQuickMenuOpen();
      const expand = await screen.findByRole("button", { name: "Expand all sections" });
      expect(expand).toBeDisabled();
      expect(screen.getByRole("button", { name: "Collapse all sections" })).toBeEnabled();
    } finally {
      pages.remove();
    }
  });
});
