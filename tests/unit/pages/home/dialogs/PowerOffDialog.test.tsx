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
import { PowerOffDialog } from "@/pages/home/dialogs/PowerOffDialog";

describe("PowerOffDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    isPending: false,
  };

  it("shows Power Off button when not pending", () => {
    render(<PowerOffDialog {...defaultProps} />);
    const btn = screen.getByRole("button", { name: "Power Off" });
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent("Power Off");
  });

  it("shows Powering off and disables button when isPending=true", () => {
    render(<PowerOffDialog {...defaultProps} isPending={true} />);
    const btn = screen.getByRole("button", { name: "Powering off\u2026" });
    expect(btn).toBeDisabled();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(<PowerOffDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Power Off" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(<PowerOffDialog {...defaultProps} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
