import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachineControls } from "@/pages/home/components/MachineControls";
import { InterstitialStateProvider } from "@/components/ui/interstitial-state";
import { installDeviceBackButton } from "@/lib/input/deviceBackButton";
import { DisplayProfileProvider, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";
import type { DisplayProfile } from "@/lib/displayProfiles";

const appListenerState = vi.hoisted(() => ({
  backButtonListener: null as null | (() => void),
  addListener: vi.fn(),
  remove: vi.fn(),
}));

const targetDevice = vi.hoisted(() => ({
  current: { deviceId: "d1", multiDevice: false, fullLabel: "c64u", shortLabel: "c64u" },
}));
vi.mock("@/hooks/useTargetDeviceIdentity", () => ({ useTargetDeviceIdentity: () => targetDevice.current }));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appListenerState.addListener,
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

const publishMachineInterruptMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/deviceInteraction/machineInterrupt", () => ({
  publishMachineInterrupt: (...args: unknown[]) => publishMachineInterruptMock(...args),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock("@/components/SectionHeader", () => ({
  SectionHeader: ({ children, title, actions }: any) => (
    <div>
      <span>{title}</span>
      {actions}
      {children}
    </div>
  ),
}));

vi.mock("@/components/layout/PageContainer", () => ({
  ProfileActionGrid: ({ children, testId, compactColumns }: any) => (
    <div data-testid={testId} data-compact-columns={compactColumns}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/QuickActionCard", () => ({
  QuickActionCard: ({ label, onClick, disabled, dataTestId }: any) => (
    <button data-testid={dataTestId ?? `action-${label}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
}));

const defaultProps = {
  status: { isConnected: true, isConnecting: false },
  machineTaskBusy: false,
  machineExecutionState: "running" as const,
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

/** Renders the tiles at a chosen display profile, the way the app's own provider resolves it. */
const ProfilePin = ({ profile }: { profile: DisplayProfile }) => {
  const { setOverride } = useDisplayProfilePreference();
  useEffect(() => setOverride(profile), [profile, setOverride]);
  return <MachineControls {...defaultProps} gameModeVisible onGameMode={vi.fn()} />;
};

const renderAtProfile = (profile: DisplayProfile) =>
  render(
    <DisplayProfileProvider>
      <ProfilePin profile={profile} />
    </DisplayProfileProvider>,
  );

describe("MachineControls", () => {
  /*
   * Android's Back key reaches Capacitor, not the WebView, and one listener is registered for the
   * whole app rather than per surface: two listeners dispatched two Escapes and dismissed one layer
   * too many. The provider that used to register it does not any more, so this installs the global
   * one the app installs.
   */
  let uninstallDeviceBackButton: (() => void) | null = null;

  afterEach(() => {
    uninstallDeviceBackButton?.();
    uninstallDeviceBackButton = null;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    appListenerState.backButtonListener = null;
    appListenerState.addListener.mockImplementation(async (eventName: string, listener: () => void) => {
      if (eventName === "backButton") {
        appListenerState.backButtonListener = listener;
      }
      return { remove: appListenerState.remove };
    });
    uninstallDeviceBackButton = installDeviceBackButton(() => undefined);
  });

  it("keeps the canonical primary quick actions in a two-column compact grid", () => {
    render(<MachineControls {...defaultProps} />);

    const buttons = screen.getByTestId("home-machine-controls").querySelectorAll("button");
    // Reboot and Power Off are rows of the Power sheet now; the grid carries the one tile that
    // opens it, so Reset stays the only destructive action a single tap can reach.
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual(["Menu", "Pause", "Reset", "Power"]);
    expect(screen.getByTestId("home-machine-controls")).toHaveAttribute("data-compact-columns", "2");
  });

  // GM-19: the first row at two columns used to be Reset + Reboot — the two most
  // destructive actions, where a thumb lands and where the keypad ring starts.
  it("opens on the watch band and keeps every destructive tile after every safe one", () => {
    render(
      <MachineControls
        {...defaultProps}
        gameModeVisible
        onGameMode={vi.fn()}
        ramActionsVisible
        onPowerCycle={vi.fn()}
        extraActions={[
          { id: "promoted.home.section.live-view", label: "Live", onSelect: vi.fn() },
          { id: "openRemoteInput", label: "Input", onSelect: vi.fn() },
          {
            id: "rebootClearMemory",
            label: "Reboot (Clr Mem)",
            variant: "danger" as const,
            onSelect: vi.fn(),
          },
          { id: "saveReuMemory", label: "Save REU", onSelect: vi.fn() },
        ]}
      />,
    );

    const labels = Array.from(screen.getByTestId("home-machine-controls").querySelectorAll("button")).map(
      (button) => button.textContent,
    );
    expect(labels.slice(0, 3)).toEqual(["Live", "Game", "Input"]);

    const destructive = ["Reset", "Power"];
    const firstDestructive = labels.findIndex((label) => destructive.includes(label ?? ""));
    const lastSafe = labels.reduce((last, label, index) => (destructive.includes(label ?? "") ? last : index), -1);
    expect(firstDestructive).toBeGreaterThan(lastSafe);
  });

  // One word on the tile, on every profile. Quick Actions is two columns at 320 CSS px so
  // "Game Mode" wrapped there, and on a wider profile the second word only repeated what the
  // icon and the tile's position already say. The tile keeps its position and its handler.
  it("labels the Game Mode tile Game on every profile", () => {
    for (const profile of ["compact", "medium", "expanded"] as const) {
      const view = renderAtProfile(profile);
      const tile = screen.getByTestId("home-machine-inline-openGameMode");
      expect(tile).toHaveTextContent("Game");
      expect(tile.textContent).not.toContain("Game Mode");
      view.unmount();
    }
  });

  it("renders experimental RAM actions only when requested", () => {
    const { rerender } = render(<MachineControls {...defaultProps} />);

    expect(screen.queryByTestId("home-save-ram")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-load-ram")).not.toBeInTheDocument();

    rerender(<MachineControls {...defaultProps} ramActionsVisible={true} />);

    expect(screen.getByTestId("home-save-ram")).toHaveTextContent("Backup");
    expect(screen.getByTestId("home-load-ram")).toHaveTextContent("Restore");
  });

  it("names the device the Power actions go to when more than one device is saved", () => {
    targetDevice.current = { ...targetDevice.current, multiDevice: true, fullLabel: "Workshop" };
    try {
      render(<MachineControls {...defaultProps} />);
      fireEvent.click(screen.getByTestId("home-power-actions"));

      expect(screen.getByTestId("home-power-sheet")).toHaveTextContent("interrupts whatever Workshop is doing");
    } finally {
      targetDevice.current = { ...targetDevice.current, multiDevice: false, fullLabel: "c64u" };
    }
  });

  it("opens Reboot confirmation before executing the REST reboot mutation", () => {
    render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("home-power-actions"));
    fireEvent.click(screen.getByTestId("home-power-action-reboot"));

    expect(screen.getByRole("dialog", { name: "Reboot?" })).toHaveTextContent("Reboot?");
    expect(defaultProps.onReboot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirm"));

    expect(defaultProps.onReboot).toHaveBeenCalledTimes(1);
    expect(defaultProps.controls.reboot.mutateAsync).not.toHaveBeenCalled();
  });

  it("opens Reset confirmation and does not call reset immediately", () => {
    render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("action-Reset"));

    expect(screen.getByRole("dialog")).toHaveTextContent("Reset?");
    expect(defaultProps.onAction).not.toHaveBeenCalled();
    expect(defaultProps.controls.reset.mutateAsync).not.toHaveBeenCalled();
  });

  it("cancels Reset confirmation without sending the machine command", () => {
    render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("action-Reset"));
    fireEvent.click(screen.getByText("Cancel"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(defaultProps.onAction).not.toHaveBeenCalled();
    expect(defaultProps.controls.reset.mutateAsync).not.toHaveBeenCalled();
  });

  it("confirms Reset exactly once after re-checking guards", async () => {
    render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("action-Reset"));
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => {
      expect(defaultProps.controls.reset.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(defaultProps.onAction).toHaveBeenCalledTimes(1);
    // HARD19-031/032: Reset now routes through publishMachineInterrupt, which
    // sets "running", publishes the takeover, and restores any pending pause-mute.
    await waitFor(() => {
      expect(publishMachineInterruptMock).toHaveBeenCalledWith({ reason: "home-reset", label: "Reset" });
    });
  });

  it("does not execute confirmed Reset if current guards become disabled", () => {
    const { rerender } = render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("action-Reset"));
    rerender(<MachineControls {...defaultProps} machineTaskBusy={true} />);
    fireEvent.click(screen.getByText("Confirm"));

    expect(defaultProps.onAction).not.toHaveBeenCalled();
    expect(defaultProps.controls.reset.mutateAsync).not.toHaveBeenCalled();
  });

  it("calls the provided menu toggle handler", () => {
    render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("action-Menu"));

    expect(defaultProps.onToggleMenu).toHaveBeenCalledTimes(1);
  });

  it("keeps Power Off delegated to the existing protected flow", () => {
    render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("home-power-actions"));
    fireEvent.click(screen.getByTestId("home-power-action-power-off"));

    expect(defaultProps.onPowerOff).toHaveBeenCalledTimes(1);
    expect(defaultProps.controls.powerOff.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("omits Power Cycle when no handler is provided", () => {
    render(<MachineControls {...defaultProps} />);
    fireEvent.click(screen.getByTestId("home-power-actions"));
    expect(screen.queryByTestId("home-power-action-power-cycle")).toBeNull();
  });

  it("opens Power Cycle confirmation before calling the handler", () => {
    const onPowerCycle = vi.fn();
    render(<MachineControls {...defaultProps} onPowerCycle={onPowerCycle} />);
    const buttons = screen.getByTestId("home-machine-controls").querySelectorAll("button");
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual(["Menu", "Pause", "Reset", "Power"]);
    fireEvent.click(screen.getByTestId("home-power-actions"));
    fireEvent.click(screen.getByTestId("home-power-action-power-cycle"));
    expect(onPowerCycle).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Power Cycle?" })).toHaveTextContent("Power Cycle?");
    fireEvent.click(screen.getByText("Confirm"));
    expect(onPowerCycle).toHaveBeenCalledTimes(1);
  });

  it("hides Power Cycle when product capability says it is unavailable", () => {
    render(
      <MachineControls
        {...defaultProps}
        powerCycleVisible={false}
        onPowerCycle={vi.fn()}
        powerCycleDisabledReason="Power Cycle is not available on Ultimate 64 Elite 3.14e."
      />,
    );

    expect(screen.queryByTestId("home-power-cycle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-machine-note-powerCycle")).not.toBeInTheDocument();
  });

  it("renders all extra quick actions inline alongside the standard actions", () => {
    const rebootClearMemory = vi.fn();
    const saveReu = vi.fn();

    render(
      <MachineControls
        {...defaultProps}
        ramActionsVisible={true}
        onPowerCycle={vi.fn()}
        extraActions={[
          { id: "rebootClearMemory", label: "Reboot (Clr Mem)", onSelect: rebootClearMemory },
          { id: "saveReuMemory", label: "Save REU", onSelect: saveReu },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("home-machine-inline-rebootClearMemory"));
    fireEvent.click(screen.getByTestId("home-machine-inline-saveReuMemory"));

    expect(rebootClearMemory).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Reboot (Clr Mem)?");
    fireEvent.click(screen.getByText("Confirm"));

    expect(rebootClearMemory).toHaveBeenCalledTimes(1);
    expect(saveReu).toHaveBeenCalledTimes(1);
  });

  it("does not add confirmation to non-destructive extra actions", () => {
    const saveReu = vi.fn();

    render(
      <MachineControls
        {...defaultProps}
        extraActions={[{ id: "saveReuMemory", label: "Save REU", onSelect: saveReu }]}
      />,
    );

    fireEvent.click(screen.getByTestId("home-machine-inline-saveReuMemory"));

    expect(saveReu).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Android Back closes destructive confirmation without executing the action", async () => {
    render(
      <InterstitialStateProvider>
        <MachineControls {...defaultProps} />
      </InterstitialStateProvider>,
    );

    fireEvent.click(screen.getByTestId("action-Reset"));
    await waitFor(() => expect(appListenerState.backButtonListener).not.toBeNull());

    act(() => {
      appListenerState.backButtonListener?.();
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(defaultProps.onAction).not.toHaveBeenCalled();
    expect(defaultProps.controls.reset.mutateAsync).not.toHaveBeenCalled();
  });

  /*
   * The dialog opens on the action it is asking about. Radix otherwise focuses the content
   * wrapper, which is not a control, and a keypad user pressed Down three times — past the close
   * button and Cancel — to reach the one thing the dialog exists to offer.
   */
  it("opens the destructive confirmation on its confirm button", async () => {
    render(
      <InterstitialStateProvider>
        <MachineControls {...defaultProps} />
      </InterstitialStateProvider>,
    );

    fireEvent.click(screen.getByTestId("action-Reset"));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm" }));
    });
  });

  it("renders every enabled quick action even in the two-column compact grid", () => {
    render(
      <MachineControls
        {...defaultProps}
        ramActionsVisible={true}
        onPowerCycle={vi.fn()}
        extraActions={[
          {
            id: "rebootClearMemory",
            label: "Reboot (Clr Mem)",
            variant: "danger" as const,
            onSelect: vi.fn(),
          },
          { id: "saveReuMemory", label: "Save REU", onSelect: vi.fn() },
        ]}
      />,
    );

    const buttons = screen.getByTestId("home-machine-controls").querySelectorAll("button");
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual([
      "Menu",
      "Pause",
      "Save REU",
      "Backup",
      "Restore",
      "Reset",
      "Power",
    ]);
    expect(screen.getByTestId("home-machine-controls")).toHaveAttribute("data-compact-columns", "2");

    // The four that were tiles are rows of the Power sheet, in increasing severity.
    fireEvent.click(screen.getByTestId("home-power-actions"));
    const sheetRows = Array.from(
      screen.getByTestId("home-power-sheet").querySelectorAll("button[data-testid^='home-power-action-']"),
    ).map((button) => button.getAttribute("data-testid"));
    expect(sheetRows).toEqual([
      "home-power-action-reboot",
      "home-power-action-rebootClearMemory",
      "home-power-action-power-cycle",
      "home-power-action-power-off",
    ]);
  });

  it("renders loading extra actions with an ellipsis label", () => {
    render(
      <MachineControls
        {...defaultProps}
        extraActions={[{ id: "rebootClearMemory", label: "Reboot (Clr Mem)", onSelect: vi.fn(), loading: true }]}
      />,
    );

    expect(screen.getByTestId("home-machine-inline-rebootClearMemory")).toHaveTextContent("Reboot (Clr Mem)…");
  });

  it("renders inline notes for disabled extra actions", () => {
    render(
      <MachineControls
        {...defaultProps}
        extraActions={[
          {
            id: "saveReuMemory",
            label: "Save REU",
            onSelect: vi.fn(),
            disabled: true,
            reason: "Save REU is not available on this device.",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("home-machine-note-saveReuMemory")).toHaveTextContent(
      "Save REU: Save REU is not available on this device.",
    );
  });
});
