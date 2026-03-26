/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClearFlashDialog } from "@/pages/home/dialogs/ClearFlashDialog";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...rest}>
      {children}
    </button>
  ),
}));

describe("ClearFlashDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    isPending: false,
  };

  it("renders when open", () => {
    render(<ClearFlashDialog {...defaultProps} />);
    expect(screen.getByText("Clear Flash Configuration?")).toBeInTheDocument();
    expect(
      screen.getByText("This will reset all saved settings to factory defaults. This cannot be undone."),
    ).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<ClearFlashDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Clear Flash Configuration?")).not.toBeInTheDocument();
  });

  it("calls onConfirm when Clear Flash button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ClearFlashDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Clear Flash"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(<ClearFlashDialog {...defaultProps} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables confirm button when isPending", () => {
    render(<ClearFlashDialog {...defaultProps} isPending={true} />);
    expect(screen.getByText("Clearing…")).toBeDisabled();
  });

  it("shows pending label when isPending", () => {
    render(<ClearFlashDialog {...defaultProps} isPending={true} />);
    expect(screen.getByText("Clearing…")).toBeInTheDocument();
    expect(screen.queryByText("Clear Flash")).not.toBeInTheDocument();
  });

  it("confirm button uses destructive variant", () => {
    render(<ClearFlashDialog {...defaultProps} />);
    expect(screen.getByText("Clear Flash")).toHaveAttribute("data-variant", "destructive");
  });
});
