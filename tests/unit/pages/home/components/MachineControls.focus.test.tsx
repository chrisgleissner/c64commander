/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MachineControls } from "@/pages/home/components/MachineControls";
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
  },
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
) =>
  render(
    <FocusNavigationProvider profileId="keypad">
      {focusContext ? <FocusContextCapture target={focusContext} /> : null}
      <MachineControls {...baseProps} {...overrides} />
    </FocusNavigationProvider>,
  );

describe("MachineControls keypad focus ring (C64U Remote)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the canonical primary actions in top-to-bottom focusOrder and center-activates the focused one", () => {
    const focusContext = { current: null as FocusNavigationContextValue | null };
    renderInRing({}, focusContext);

    // Selection starts on the labelled Quick Actions group; OK descends to the
    // first child, then stepping down walks Reset → Reboot → Pause → Menu.
    expect(focusContext.current?.engine.sourceForId("home-machine-reset")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-machine-reboot")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-machine-pause-resume")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-machine-menu")).toBe("dom+explicit");
    expect(focusContext.current?.engine.sourceForId("home-machine-power-off")).toBe("dom+explicit");
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reboot" }));
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pause" }));
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menu" }));

    // Center fires only the focused (non-destructive) action; no dialog, no other handler.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(baseProps.onToggleMenu).toHaveBeenCalledTimes(1);
    expect(baseProps.onPowerOff).not.toHaveBeenCalled();
    expect(baseProps.onPauseResume).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("orders Power Off last in the section (reachable by stepping back from the top)", () => {
    renderInRing();

    // Descend into the section; from the top, a backward step wraps to the highest order
    // (Power Off at 190), proving it traverses after every other machine action.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    fireEvent.keyDown(document.body, { code: "DpadUp" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Power Off" }));

    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(baseProps.onPowerOff).toHaveBeenCalledTimes(1);
  });

  it("keeps pruned RAM / Power Cycle actions out of the ring (only the five canonical actions cycle)", () => {
    // Mirrors the C64U Remote surface: ramActionsVisible and onPowerCycle absent.
    renderInRing();

    expect(screen.queryByRole("button", { name: "Save RAM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Power Cycle" })).not.toBeInTheDocument();

    // Descend, then five DpadDown steps from the first child wrap exactly back to the first card,
    // confirming the ring holds only the five visible actions.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));
    const order = ["Reboot", "Pause", "Menu", "Power Off", "Reset"];
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
