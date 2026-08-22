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
  // The card is one of several closed on a first visit; these tests are about its contents.
  defaultOpen: true,
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

  it("renders footer when provided", () => {
    render(<DriveCard {...defaultProps} footer={<div data-testid="drive-footer">footer content</div>} />);
    expect(screen.getByTestId("drive-footer")).toBeInTheDocument();
    expect(screen.getByTestId("drive-footer")).toHaveTextContent("footer content");
  });

  it("does not render footer when not provided", () => {
    render(<DriveCard {...defaultProps} />);
    expect(screen.queryByTestId("drive-footer")).not.toBeInTheDocument();
  });

  /**
   * The labels beside the controls must not shrink below their own text.
   *
   * `src/index.css` gives every flex and grid child `min-width: 0`, which removes the
   * `min-width: auto` that otherwise stops a flex item shrinking below its content. A label
   * carrying `whitespace-nowrap` and no `overflow: hidden` then keeps its full text while its
   * BOX shrinks, and the text spills over the control beside it: on Home the Drives card
   * rendered "B8s ID" and "T1541pe", the Bus ID and Type values painted on top of their own
   * labels.
   *
   * jsdom computes no layout, so this asserts the class that prevents the shrink rather than
   * the pixels. It is the exact thing that was missing, and the same guard SidCard already
   * carried on the labels that never had the fault.
   */
  it("keeps the Disk, Bus ID and Type labels from shrinking under their own text", () => {
    render(<DriveCard {...defaultProps} mountedPath="game.d64" typeValue="1541" typeOptions={["1541", "1571"]} />);
    for (const text of ["Disk", "Bus ID", "Type"]) {
      const label = screen.getByText(text);
      expect(label.className, `the "${text}" label may not shrink below its text`).toContain("shrink-0");
      expect(label.className).toContain("whitespace-nowrap");
    }
  });
});
