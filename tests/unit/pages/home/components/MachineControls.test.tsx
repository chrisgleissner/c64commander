import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MachineControls } from "@/pages/home/components/MachineControls";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/SectionHeader", () => ({
  SectionHeader: ({ children, title }: any) => (
    <div>
      <span>{title}</span>
      {children}
    </div>
  ),
}));

vi.mock("@/components/layout/PageContainer", () => ({
  ProfileActionGrid: ({ children }: any) => <div>{children}</div>,
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
  onRebootClearMemory: vi.fn(),
  onPowerOff: vi.fn(),
  onAction: vi.fn().mockImplementation((fn: () => Promise<void>) => fn()),
};

describe("MachineControls", () => {
  it("hides Power Cycle when telnet is available but no handler is provided", () => {
    render(<MachineControls {...defaultProps} telnetAvailable={true} />);
    expect(screen.queryByTestId("home-power-cycle")).not.toBeInTheDocument();
  });

  it("renders and calls Power Cycle when a handler is provided", () => {
    const onPowerCycle = vi.fn();
    render(<MachineControls {...defaultProps} telnetAvailable={true} onPowerCycle={onPowerCycle} />);
    fireEvent.click(screen.getByTestId("home-power-cycle"));
    expect(onPowerCycle).toHaveBeenCalledTimes(1);
  });
});
