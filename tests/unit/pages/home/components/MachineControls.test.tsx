import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MachineControls } from "@/pages/home/components/MachineControls";
import { InterstitialStateProvider } from "@/components/ui/interstitial-state";

const appListenerState = vi.hoisted(() => ({
  backButtonListener: null as null | (() => void),
  addListener: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appListenerState.addListener,
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
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

describe("MachineControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appListenerState.backButtonListener = null;
    appListenerState.addListener.mockImplementation(async (eventName: string, listener: () => void) => {
      if (eventName === "backButton") {
        appListenerState.backButtonListener = listener;
      }
      return { remove: appListenerState.remove };
    });
  });

  it("keeps the canonical primary quick actions in a two-column compact grid", () => {
    render(<MachineControls {...defaultProps} />);

    const buttons = screen.getByTestId("home-machine-controls").querySelectorAll("button");
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual([
      "Reset",
      "Reboot",
      "Pause",
      "Menu",
      "Power Off",
    ]);
    expect(screen.getByTestId("home-machine-controls")).toHaveAttribute("data-compact-columns", "2");
  });

  it("renders experimental RAM actions only when requested", () => {
    const { rerender } = render(<MachineControls {...defaultProps} />);

    expect(screen.queryByTestId("home-save-ram")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-load-ram")).not.toBeInTheDocument();

    rerender(<MachineControls {...defaultProps} ramActionsVisible={true} />);

    expect(screen.getByTestId("home-save-ram")).toHaveTextContent("Save RAM");
    expect(screen.getByTestId("home-load-ram")).toHaveTextContent("Load RAM");
  });

  it("opens Reboot confirmation before executing the REST reboot mutation", () => {
    render(<MachineControls {...defaultProps} />);

    fireEvent.click(screen.getByTestId("action-Reboot"));

    expect(screen.getByRole("dialog")).toHaveTextContent("Reboot?");
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
    expect(defaultProps.setMachineExecutionState).toHaveBeenCalledWith("running");
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

    fireEvent.click(screen.getByTestId("action-Power Off"));

    expect(defaultProps.onPowerOff).toHaveBeenCalledTimes(1);
    expect(defaultProps.controls.powerOff.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("omits Power Cycle when no handler is provided", () => {
    render(<MachineControls {...defaultProps} />);
    expect(screen.queryByTestId("home-power-cycle")).toBeNull();
  });

  it("opens Power Cycle confirmation before calling the handler", () => {
    const onPowerCycle = vi.fn();
    render(<MachineControls {...defaultProps} onPowerCycle={onPowerCycle} />);
    const buttons = screen.getByTestId("home-machine-controls").querySelectorAll("button");
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual([
      "Reset",
      "Reboot",
      "Pause",
      "Menu",
      "Power Cycle",
      "Power Off",
    ]);
    fireEvent.click(screen.getByTestId("home-power-cycle"));
    expect(onPowerCycle).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("Power Cycle?");
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

  it("renders every enabled quick action even in the two-column compact grid", () => {
    render(
      <MachineControls
        {...defaultProps}
        ramActionsVisible={true}
        onPowerCycle={vi.fn()}
        extraActions={[
          { id: "rebootClearMemory", label: "Reboot (Clr Mem)", onSelect: vi.fn() },
          { id: "saveReuMemory", label: "Save REU", onSelect: vi.fn() },
        ]}
      />,
    );

    const buttons = screen.getByTestId("home-machine-controls").querySelectorAll("button");
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual([
      "Reset",
      "Reboot",
      "Pause",
      "Menu",
      "Save RAM",
      "Load RAM",
      "Power Cycle",
      "Reboot (Clr Mem)",
      "Save REU",
      "Power Off",
    ]);
    expect(screen.getByTestId("home-machine-controls")).toHaveAttribute("data-compact-columns", "2");
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
