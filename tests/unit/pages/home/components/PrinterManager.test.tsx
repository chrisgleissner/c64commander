/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrinterManager } from "@/pages/home/components/PrinterManager";

const { updateConfigValueSpy, resolveConfigValueSpy } = vi.hoisted(() => ({
  updateConfigValueSpy: vi.fn().mockResolvedValue(undefined),
  resolveConfigValueSpy: vi.fn(
    (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
  ),
}));

vi.mock("@/pages/home/hooks/ConfigActionsContext", () => ({
  useSharedConfigActions: () => ({
    configWritePending: {},
    updateConfigValue: updateConfigValueSpy,
    resolveConfigValue: resolveConfigValueSpy,
  }),
}));

vi.mock("@/pages/home/hooks/usePrinterData", () => ({
  usePrinterData: () => ({
    refetchDrives: vi.fn().mockResolvedValue(undefined),
    printerConfig: undefined,
    printerDevice: { enabled: true, busId: 4 },
  }),
}));

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: "medium" }),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () => Object.assign((fn: (...args: any[]) => any) => fn, { scope: vi.fn() }),
}));

vi.mock("@/components/SectionHeader", () => ({
  SectionHeader: ({ title, resetAction, resetDisabled, resetTestId, isResetting }: any) => (
    <div>
      <span>{title}</span>
      <button
        onClick={resetAction}
        disabled={resetDisabled}
        data-testid={resetTestId}
        data-resetting={String(isResetting)}
      >
        Reset
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, "data-testid": testId, className }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid={testId} className={className}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <div data-value={value} data-disabled={String(disabled)}>
      <button onClick={() => onValueChange && onValueChange("5")} data-testid={`select-change-${value}`}>
        Change
      </button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, "data-testid": testId }: any) => <div data-testid={testId}>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));

const defaultProps = {
  isConnected: true,
  machineTaskBusy: false,
  machineTaskId: null,
  onResetPrinter: vi.fn().mockResolvedValue(undefined),
};

describe("PrinterManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    );
  });

  it("renders the Printers section header", () => {
    render(<PrinterManager {...defaultProps} />);
    expect(screen.getByText("Printers")).toBeInTheDocument();
  });

  it("renders printer group container", () => {
    render(<PrinterManager {...defaultProps} />);
    expect(screen.getByTestId("home-printer-group")).toBeInTheDocument();
  });

  it("renders printer toggle button", () => {
    render(<PrinterManager {...defaultProps} />);
    expect(screen.getByTestId("home-printer-toggle")).toBeInTheDocument();
  });

  it("shows ON when printer enabled (default fallback is Enabled from device)", () => {
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    );
    // The default: printerDevice.enabled=true → fallback is 'Enabled'
    render(<PrinterManager {...defaultProps} />);
    expect(screen.getByTestId("home-printer-toggle")).toHaveTextContent("ON");
  });

  it("shows OFF when printer resolves as Disabled", () => {
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, category: string, itemName: string, _fallback: string | number) => {
        if (category === "Printer Settings" && itemName === "IEC printer") return "Disabled";
        return _fallback;
      },
    );
    render(<PrinterManager {...defaultProps} />);
    expect(screen.getByTestId("home-printer-toggle")).toHaveTextContent("OFF");
  });

  it("disables toggle button when not connected", () => {
    render(<PrinterManager {...defaultProps} isConnected={false} />);
    expect(screen.getByTestId("home-printer-toggle")).toBeDisabled();
  });

  it("calls updateConfigValue when toggle is clicked (enabled → disabled)", () => {
    render(<PrinterManager {...defaultProps} />);
    fireEvent.click(screen.getByTestId("home-printer-toggle"));
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      "Printer Settings",
      "IEC printer",
      "Disabled",
      "HOME_DRIVE_ENABLED",
      "Printer disabled",
      { refreshDrives: true },
    );
  });

  it("renders the bus ID select", () => {
    render(<PrinterManager {...defaultProps} />);
    expect(screen.getByTestId("home-printer-bus")).toBeInTheDocument();
  });

  it("calls updateConfigValue when bus ID changes", () => {
    render(<PrinterManager {...defaultProps} />);
    // bus ID select is first select rendered
    const busSelect = screen.getByTestId("home-printer-bus").closest("[data-value]");
    const changeBtn = busSelect?.querySelector('[data-testid^="select-change-"]') as HTMLButtonElement;
    fireEvent.click(changeBtn);
    expect(updateConfigValueSpy).toHaveBeenCalledWith(
      "Printer Settings",
      "Bus ID",
      5,
      "HOME_PRINTER_BUS",
      "Printer bus ID updated",
      { refreshDrives: true },
    );
  });

  it("calls onResetPrinter when reset is clicked", async () => {
    const onResetPrinter = vi.fn().mockResolvedValue(undefined);
    render(<PrinterManager {...defaultProps} onResetPrinter={onResetPrinter} />);
    fireEvent.click(screen.getByTestId("home-printer-reset"));
    expect(onResetPrinter).toHaveBeenCalled();
  });

  it("shows reset button as resetting when machineTaskId=reset-printer", () => {
    render(<PrinterManager {...defaultProps} machineTaskId="reset-printer" />);
    expect(screen.getByTestId("home-printer-reset")).toHaveAttribute("data-resetting", "true");
  });

  it("shows reset button as not resetting otherwise", () => {
    render(<PrinterManager {...defaultProps} machineTaskId={null} />);
    expect(screen.getByTestId("home-printer-reset")).toHaveAttribute("data-resetting", "false");
  });
});

describe("PrinterManager – telnet controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, _category: string, _itemName: string, fallback: string | number) => fallback,
    );
  });

  it("hides telnet buttons when telnetAvailable is false", () => {
    render(<PrinterManager {...defaultProps} telnetAvailable={false} />);
    expect(screen.queryByTestId("home-printer-flush")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-printer-telnet-reset")).not.toBeInTheDocument();
  });

  it("shows telnet buttons when telnetAvailable and printer enabled", () => {
    render(<PrinterManager {...defaultProps} telnetAvailable={true} />);
    expect(screen.getByTestId("home-printer-flush")).toBeInTheDocument();
    expect(screen.getByTestId("home-printer-telnet-reset")).toBeInTheDocument();
  });

  it("hides telnet buttons when printer is disabled", () => {
    resolveConfigValueSpy.mockImplementation(
      (_payload: unknown, category: string, itemName: string, _fallback: string | number) => {
        if (category === "Printer Settings" && itemName === "IEC printer") return "Disabled";
        return _fallback;
      },
    );
    render(<PrinterManager {...defaultProps} telnetAvailable={true} />);
    expect(screen.queryByTestId("home-printer-flush")).not.toBeInTheDocument();
  });

  it("calls onTelnetAction with printerFlush when Flush is clicked", () => {
    const onTelnetAction = vi.fn().mockResolvedValue(undefined);
    render(<PrinterManager {...defaultProps} telnetAvailable={true} onTelnetAction={onTelnetAction} />);
    fireEvent.click(screen.getByTestId("home-printer-flush"));
    expect(onTelnetAction).toHaveBeenCalledWith("printerFlush");
  });

  it("calls onTelnetAction with printerReset when Reset is clicked", () => {
    const onTelnetAction = vi.fn().mockResolvedValue(undefined);
    render(<PrinterManager {...defaultProps} telnetAvailable={true} onTelnetAction={onTelnetAction} />);
    fireEvent.click(screen.getByTestId("home-printer-telnet-reset"));
    expect(onTelnetAction).toHaveBeenCalledWith("printerReset");
  });

  it("disables telnet buttons when telnetBusy", () => {
    render(<PrinterManager {...defaultProps} telnetAvailable={true} telnetBusy={true} />);
    expect(screen.getByTestId("home-printer-flush")).toBeDisabled();
    expect(screen.getByTestId("home-printer-telnet-reset")).toBeDisabled();
  });

  it("disables telnet buttons when machineTaskBusy", () => {
    render(<PrinterManager {...defaultProps} telnetAvailable={true} machineTaskBusy={true} />);
    expect(screen.getByTestId("home-printer-flush")).toBeDisabled();
    expect(screen.getByTestId("home-printer-telnet-reset")).toBeDisabled();
  });

  it("shows loading text for active telnet action", () => {
    render(<PrinterManager {...defaultProps} telnetAvailable={true} telnetActiveActionId="printerFlush" />);
    expect(screen.getByTestId("home-printer-flush")).toHaveTextContent("Flushing…");
  });
});
