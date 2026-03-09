/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DriveCard } from "@/pages/home/DriveCard";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <div data-value={value} data-disabled={String(disabled)}>
      <button onClick={() => onValueChange && onValueChange("opt1")}>Change</button>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));

const defaultProps = {
  name: "Drive 8",
  enabled: true,
  onToggle: vi.fn(),
  busIdValue: "8",
  busIdOptions: ["8", "9"],
  onBusIdChange: vi.fn(),
  statusSummary: "OK",
  isConnected: true,
  testIdSuffix: "d8",
};

describe("DriveCard", () => {
  it("renders name and status", () => {
    render(<DriveCard {...defaultProps} />);
    expect(screen.getByText("Drive 8")).toBeInTheDocument();
    expect(screen.getByTestId("home-drive-status-d8")).toHaveTextContent("OK");
  });

  it("shows ON/OFF based on enabled prop", () => {
    const { rerender } = render(<DriveCard {...defaultProps} enabled={true} />);
    expect(screen.getByTestId("home-drive-toggle-d8")).toHaveTextContent("ON");

    rerender(<DriveCard {...defaultProps} enabled={false} />);
    expect(screen.getByTestId("home-drive-toggle-d8")).toHaveTextContent("OFF");
  });

  it("hides mounted path section when neither mountedPath nor pathValue is set", () => {
    render(<DriveCard {...defaultProps} />);
    expect(screen.queryByTestId("home-drive-mounted-d8")).not.toBeInTheDocument();
  });

  it("shows mounted path section when mountedPath is set", () => {
    render(<DriveCard {...defaultProps} mountedPath="game.d64" />);
    expect(screen.getByTestId("home-drive-mounted-d8")).toHaveTextContent("game.d64");
  });

  it("shows mounted path section when pathValue is set (deprecated prop)", () => {
    render(<DriveCard {...defaultProps} pathValue="old.d64" />);
    expect(screen.getByTestId("home-drive-mounted-d8")).toHaveTextContent("old.d64");
  });

  it("shows Select... when mountedPath is empty string and no pathValue", () => {
    render(<DriveCard {...defaultProps} mountedPath="" />);
    expect(screen.getByTestId("home-drive-mounted-d8")).toHaveTextContent("Select...");
  });

  it("uses mountedPathLabel when provided", () => {
    render(<DriveCard {...defaultProps} mountedPath="game.d64" mountedPathLabel="Image" />);
    expect(screen.getByText("Image")).toBeInTheDocument();
  });

  it("falls back to Disk label when mountedPathLabel not provided", () => {
    render(<DriveCard {...defaultProps} mountedPath="game.d64" />);
    expect(screen.getByText("Disk")).toBeInTheDocument();
  });

  it("prefers mountedPath over pathValue", () => {
    render(<DriveCard {...defaultProps} mountedPath="new.d64" pathValue="old.d64" />);
    expect(screen.getByTestId("home-drive-mounted-d8")).toHaveTextContent("new.d64");
  });

  it("calls onMountedPathClick when path button clicked", () => {
    const onMountedPathClick = vi.fn();
    render(<DriveCard {...defaultProps} mountedPath="game.d64" onMountedPathClick={onMountedPathClick} />);
    fireEvent.click(screen.getByTestId("home-drive-mounted-d8"));
    expect(onMountedPathClick).toHaveBeenCalledTimes(1);
  });

  it("status button is clickable with onStatusClick", () => {
    const onStatusClick = vi.fn();
    render(<DriveCard {...defaultProps} onStatusClick={onStatusClick} />);
    const statusBtn = screen.getByTestId("home-drive-status-d8");
    expect(statusBtn).toBeEnabled();
    fireEvent.click(statusBtn);
    expect(onStatusClick).toHaveBeenCalledTimes(1);
  });

  it("status button is disabled without onStatusClick", () => {
    render(<DriveCard {...defaultProps} />);
    expect(screen.getByTestId("home-drive-status-d8")).toBeDisabled();
  });

  it("shows type select when typeValue is provided", () => {
    render(<DriveCard {...defaultProps} typeValue="1541" typeOptions={["1541", "1571"]} onTypeChange={vi.fn()} />);
    expect(screen.getByTestId("home-drive-type-d8")).toBeInTheDocument();
  });

  it("disables toggle when not connected", () => {
    render(<DriveCard {...defaultProps} isConnected={false} />);
    expect(screen.getByTestId("home-drive-toggle-d8")).toBeDisabled();
  });
});
