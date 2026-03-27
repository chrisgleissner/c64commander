import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MachineControls } from "@/pages/home/components/MachineControls";

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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...props }: any) => (
    <button type="button" onClick={onSelect} {...props}>
      {children}
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
  onAction: vi.fn().mockImplementation((fn: () => Promise<void>) => fn()),
};

describe("MachineControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the canonical eight primary quick actions in order", () => {
    render(<MachineControls {...defaultProps} telnetAvailable={true} />);

    const buttons = screen.getByTestId("home-machine-controls").querySelectorAll("button");
    expect(Array.from(buttons).map((button) => button.textContent)).toEqual([
      "Reset",
      "Reboot",
      "Pause",
      "Menu",
      "Save RAM",
      "Load RAM",
      "Power Cycle",
      "Power Off",
    ]);
    expect(screen.getByTestId("home-machine-controls")).toHaveAttribute("data-compact-columns", "4");
  });

  it("keeps the primary reboot action enabled without telnet and executes the REST reboot mutation", () => {
    render(<MachineControls {...defaultProps} telnetAvailable={false} />);

    fireEvent.click(screen.getByTestId("action-Reboot"));

    expect(defaultProps.controls.reboot.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("routes the primary reboot action through telnet when a telnet reboot handler is provided", () => {
    const onReboot = vi.fn();

    render(<MachineControls {...defaultProps} telnetAvailable={true} onReboot={onReboot} />);

    fireEvent.click(screen.getByTestId("action-Reboot"));

    expect(onReboot).toHaveBeenCalledTimes(1);
    expect(defaultProps.controls.reboot.mutateAsync).not.toHaveBeenCalled();
  });

  it("disables Power Cycle when Telnet is unavailable or no handler is provided", () => {
    render(<MachineControls {...defaultProps} telnetAvailable={true} />);
    expect(screen.getByTestId("home-power-cycle")).toBeDisabled();
  });

  it("renders and calls Power Cycle when a handler is provided", () => {
    const onPowerCycle = vi.fn();
    render(<MachineControls {...defaultProps} telnetAvailable={true} onPowerCycle={onPowerCycle} />);
    fireEvent.click(screen.getByTestId("home-power-cycle"));
    expect(onPowerCycle).toHaveBeenCalledTimes(1);
  });

  it("renders overflow actions in the section header menu", () => {
    const rebootKeepMemory = vi.fn();
    const saveReu = vi.fn();

    render(
      <MachineControls
        {...defaultProps}
        telnetAvailable={true}
        overflowActions={[
          { id: "rebootKeepMemory", label: "Reboot (Keep RAM)", onSelect: rebootKeepMemory },
          { id: "saveReuMemory", label: "Save REU", onSelect: saveReu },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("home-machine-overflow-rebootKeepMemory"));
    fireEvent.click(screen.getByTestId("home-machine-overflow-saveReuMemory"));

    expect(rebootKeepMemory).toHaveBeenCalledTimes(1);
    expect(saveReu).toHaveBeenCalledTimes(1);
  });

  it("renders loading overflow actions with an ellipsis label", () => {
    render(
      <MachineControls
        {...defaultProps}
        telnetAvailable={true}
        overflowActions={[{ id: "rebootKeepMemory", label: "Reboot (Keep RAM)", onSelect: vi.fn(), loading: true }]}
      />,
    );

    expect(screen.getByTestId("home-machine-overflow-rebootKeepMemory")).toHaveTextContent("Reboot (Keep RAM)…");
  });
});
