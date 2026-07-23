/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiskContentsDialog } from "@/components/disks/DiskContentsDialog";
import type { DiskDirectoryEntry } from "@/lib/disks/diskImage";

const entry = (overrides: Partial<DiskDirectoryEntry>): DiskDirectoryEntry => ({
  index: 0,
  name: "PROG",
  rawName: new Uint8Array(16),
  type: "PRG",
  closed: true,
  locked: false,
  startTrack: 1,
  startSector: 0,
  blocks: 3,
  loadAddress: 0x0801,
  ...overrides,
});

describe("DiskContentsDialog", () => {
  it("renders entries with type, blocks and load address, and fires actions", () => {
    const onAction = vi.fn();
    const entries = [entry({ index: 0, name: "GAME", blocks: 42 }), entry({ index: 1, name: "MUSIC", type: "SEQ" })];
    render(
      <DiskContentsDialog open onOpenChange={vi.fn()} diskName="COMPILATION" entries={entries} onAction={onAction} />,
    );
    expect(screen.getByText("GAME")).toBeInTheDocument();
    expect(screen.getByText("42 blocks · $0801")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("disk-entry-run-0"));
    expect(onAction).toHaveBeenCalledWith("run", entries[0]);
    fireEvent.click(screen.getByTestId("disk-entry-load-0"));
    expect(onAction).toHaveBeenCalledWith("load", entries[0]);
    fireEvent.click(screen.getByTestId("disk-entry-mount-0"));
    expect(onAction).toHaveBeenCalledWith("mountAndLoad", entries[0]);
  });

  it("disables launch for a non-PRG entry with a reason", () => {
    const entries = [entry({ index: 0, name: "DATA", type: "SEQ" })];
    render(<DiskContentsDialog open onOpenChange={vi.fn()} diskName="D" entries={entries} onAction={vi.fn()} />);
    expect(screen.getByText("SEQ files can't be launched directly")).toBeInTheDocument();
    expect(screen.queryByTestId("disk-entry-run-0")).not.toBeInTheDocument();
  });

  it("disables launch for a splat (unclosed) PRG", () => {
    const entries = [entry({ index: 0, name: "OPEN", closed: false })];
    render(<DiskContentsDialog open onOpenChange={vi.fn()} diskName="D" entries={entries} onAction={vi.fn()} />);
    expect(screen.getByText("Unclosed (splat) file — cannot launch")).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    const { rerender } = render(
      <DiskContentsDialog open onOpenChange={vi.fn()} diskName="D" entries={null} loading onAction={vi.fn()} />,
    );
    expect(screen.getByTestId("disk-contents-loading")).toBeInTheDocument();
    rerender(
      <DiskContentsDialog
        open
        onOpenChange={vi.fn()}
        diskName="D"
        entries={null}
        error="Unreadable directory"
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("disk-contents-error")).toHaveTextContent("Unreadable directory");
  });

  it("busyIndex disables that row's buttons", () => {
    const entries = [entry({ index: 0, name: "BUSY" })];
    render(
      <DiskContentsDialog
        open
        onOpenChange={vi.fn()}
        diskName="D"
        entries={entries}
        busyIndex={0}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("disk-entry-run-0")).toBeDisabled();
  });
});
