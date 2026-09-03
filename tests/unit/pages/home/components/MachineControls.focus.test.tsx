/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MachineControls } from "@/pages/home/components/MachineControls";
import { enterKeyNavigationModality, leaveKeyNavigationModality } from "../../../../helpers/keypadModality";

afterEach(() => leaveKeyNavigationModality());
import {
  FocusNavigationProvider,
  useFocusNavigationContext,
  type FocusNavigationContextValue,
} from "@/hooks/useFocusNavigation";

// The other MachineControls suite stubs QuickActionCard; here we deliberately use
// the REAL card so the keypad focus ring (focusId/focusOrder) is exercised. Keep
// the animation + native shims out of the way, but leave the card untouched.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
}));

vi.mock("@/lib/ui/buttonInteraction", () => ({
  handlePointerButtonClick: vi.fn(),
}));

const baseProps = {
  status: { isConnected: true, isConnecting: false },
  machineTaskBusy: false,
  machineExecutionState: "running" as const,
  setMachineExecutionState: vi.fn(),
  controls: {
    reset: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    reboot: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    powerOff: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
    menuButton: { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
  },
  pauseResumePending: false,
  machineTaskId: null,
  onPauseResume: vi.fn(),
  onSaveRam: vi.fn(),
  onLoadRam: vi.fn(),
  onPowerOff: vi.fn(),
  onReboot: vi.fn(),
  onToggleMenu: vi.fn(),
  onAction: vi.fn().mockImplementation((fn: () => Promise<void>) => fn()),
};

const FocusContextCapture = ({ target }: { target: { current: FocusNavigationContextValue | null } }) => {
  target.current = useFocusNavigationContext();
  return null;
};

const renderInRing = (
  overrides: Partial<typeof baseProps> = {},
  focusContext?: { current: FocusNavigationContextValue | null },
) => {
  // HARD27-039: a keypad user arrives here by key, so the discovery engine is
  // already running when the component mounts. These tests read the ring without
  // pressing a key first.
  enterKeyNavigationModality();
  return render(
    <FocusNavigationProvider profileId="keypad">
      {focusContext ? <FocusContextCapture target={focusContext} /> : null}
      <MachineControls {...baseProps} {...overrides} />
    </FocusNavigationProvider>,
  );
};

describe("MachineControls keypad focus ring (C64U Remote)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the canonical primary actions in top-to-bottom focusOrder and center-activates the focused one", () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderInRing({}, focusContext);

    // Quick Actions is itself collapsible now, so its own toggle is the ring's first
    // stop. Selection starts there; OK establishes focus without activating (the
    // section is already open), and stepping down from it walks Menu → Pause → Reset →
    // Power.
    expect(focusContext.current?.engine.sourceForId("home-machine-reset")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-machine-power")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-machine-pause-resume")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-machine-menu")).toBe("dom+explicit");
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(document.activeElement).toBe(screen.getByTestId("home-section-toggle-quick-actions"));

    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menu" }));

    // Center fires only the focused (non-destructive) action; no dialog, no other handler.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(baseProps.onToggleMenu).toHaveBeenCalledTimes(1);
    expect(baseProps.onPowerOff).not.toHaveBeenCalled();
    expect(baseProps.onPauseResume).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("orders Power last in the section (reachable by stepping back from the top)", () => {
    renderInRing();

    // Descend into the section; from the top, a backward step wraps to the highest order
    // (the Power tile at 180), proving it traverses after every other machine action.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    fireEvent.keyDown(document.body, { code: "DpadUp" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Power" }));

    // Power Off is a row of the sheet the Power tile opens, and is still reachable from here.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    fireEvent.click(screen.getByTestId("home-power-action-power-off"));
    expect(baseProps.onPowerOff).toHaveBeenCalledTimes(1);
  });

  it("keeps pruned RAM / Power Cycle actions out of the ring (only the four canonical actions cycle)", () => {
    // Mirrors the C64U Remote surface: ramActionsVisible and onPowerCycle absent.
    renderInRing();

    expect(screen.queryByRole("button", { name: "Backup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Power Cycle" })).not.toBeInTheDocument();

    // Enter the ring (lands on the section's own toggle, its first stop), step once more
    // onto the first card, then five DpadDown steps - one for the toggle, four for the
    // actions - wrap exactly back to it, confirming the ring holds only those five stops.
    // Reboot and Power Off are rows of the Power sheet now, so the Power tile is one stop
    // where the three of them used to be three.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menu" }));
    const order = ["Pause", "Reset", "Power", "Quick Actions", "Menu"];
    for (const name of order) {
      fireEvent.keyDown(document.body, { code: "DpadDown" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name }));
    }
  });

  it("skips every machine CTA while disconnected so a destructive action cannot be reached", () => {
    renderInRing({ status: { isConnected: false, isConnecting: false } });

    // All cards are disabled (not connected), so the ring has no enabled item:
    // d-pad + center resolve to no-ops and never fire a handler or open a dialog.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    fireEvent.keyDown(document.body, { code: "DpadCenter" });

    expect(baseProps.onToggleMenu).not.toHaveBeenCalled();
    expect(baseProps.onPowerOff).not.toHaveBeenCalled();
    expect(baseProps.onAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
