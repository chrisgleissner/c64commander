/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SnapshotManagerDialog } from "@/pages/home/dialogs/SnapshotManagerDialog";
import type { SnapshotStorageEntry } from "@/lib/snapshot/snapshotTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSnapshot = (
  id: string,
  type: SnapshotStorageEntry["snapshotType"] = "program",
  label?: string,
): SnapshotStorageEntry => ({
  id,
  filename: `c64-${type}-20260110-090000.c64snap`,
  bytesBase64: "",
  createdAt: "2026-01-10T09:00:00.000Z",
  snapshotType: type,
  metadata: {
    snapshot_type: type,
    display_ranges: type === "program" ? ["$0000–$00FF", "$0200–$FFFF"] : ["$0801–STREND"],
    created_at: "2026-01-10 09:00:00",
    ...(label ? { label } : {}),
  },
});

const SNAPSHOTS: SnapshotStorageEntry[] = [
  makeSnapshot("snap-1", "program", "Before game"),
  makeSnapshot("snap-2", "basic"),
  makeSnapshot("snap-3", "screen"),
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const renderDialog = (snapshots: SnapshotStorageEntry[] = SNAPSHOTS) => {
  const onRestore = vi.fn();
  const onDelete = vi.fn();
  const onUpdateLabel = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SnapshotManagerDialog
      open={true}
      onOpenChange={onOpenChange}
      snapshots={snapshots}
      onRestore={onRestore}
      onDelete={onDelete}
      onUpdateLabel={onUpdateLabel}
    />,
  );
  return { onRestore, onDelete, onOpenChange, onUpdateLabel };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SnapshotManagerDialog – empty state", () => {
  it("shows 'No snapshots saved yet.' when no snapshots exist", () => {
    renderDialog([]);
    expect(screen.getByTestId("snapshot-empty")).toHaveTextContent("No snapshots saved yet.");
  });
});

describe("SnapshotManagerDialog – populated list", () => {
  it("renders a row for each snapshot", () => {
    renderDialog();
    expect(screen.getAllByTestId("snapshot-row")).toHaveLength(SNAPSHOTS.length);
  });

  it("clicking a row calls onRestore with that snapshot", () => {
    const { onRestore } = renderDialog();
    fireEvent.click(screen.getAllByTestId("snapshot-row")[0]);
    expect(onRestore).toHaveBeenCalledWith(SNAPSHOTS[0]);
  });

  it("pressing Enter on a row calls onRestore", () => {
    const { onRestore } = renderDialog();
    fireEvent.keyDown(screen.getAllByTestId("snapshot-row")[1], { key: "Enter" });
    expect(onRestore).toHaveBeenCalledWith(SNAPSHOTS[1]);
  });

  it("pressing Space on a row calls onRestore", () => {
    const { onRestore } = renderDialog();
    fireEvent.keyDown(screen.getAllByTestId("snapshot-row")[0], { key: " " });
    expect(onRestore).toHaveBeenCalledWith(SNAPSHOTS[0]);
  });

  it("pressing another key on a row does not call onRestore", () => {
    const { onRestore } = renderDialog();
    fireEvent.keyDown(screen.getAllByTestId("snapshot-row")[0], { key: "Tab" });
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("clicking the delete button calls onDelete with the snapshot id", () => {
    const { onDelete } = renderDialog();
    fireEvent.click(screen.getAllByTestId("snapshot-delete")[0]);
    expect(onDelete).toHaveBeenCalledWith(SNAPSHOTS[0].id);
  });

  it("delete click does not propagate to onRestore", () => {
    const { onRestore } = renderDialog();
    fireEvent.click(screen.getAllByTestId("snapshot-delete")[0]);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("opens a compact comment editor without triggering restore", () => {
    const { onRestore } = renderDialog();
    fireEvent.click(screen.getByTestId("snapshot-comment-toggle-snap-1"));
    expect(screen.getByTestId("snapshot-comment-input-snap-1")).toHaveValue("Before game");
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("saves an edited comment", () => {
    const { onUpdateLabel } = renderDialog();
    fireEvent.click(screen.getByTestId("snapshot-comment-toggle-snap-1"));
    fireEvent.change(screen.getByTestId("snapshot-comment-input-snap-1"), { target: { value: "After game" } });
    fireEvent.click(screen.getByTestId("snapshot-comment-confirm-snap-1"));
    expect(onUpdateLabel).toHaveBeenCalledWith("snap-1", "After game");
  });

  it("cancels comment editing without saving", () => {
    const { onUpdateLabel } = renderDialog();
    fireEvent.click(screen.getByTestId("snapshot-comment-toggle-snap-2"));
    fireEvent.change(screen.getByTestId("snapshot-comment-input-snap-2"), { target: { value: "Draft note" } });
    fireEvent.click(screen.getByTestId("snapshot-comment-cancel-snap-2"));
    expect(onUpdateLabel).not.toHaveBeenCalled();
    expect(screen.queryByTestId("snapshot-comment-input-snap-2")).not.toBeInTheDocument();
  });
});

describe("SnapshotManagerDialog – text filter", () => {
  it("shows 'No snapshots match the filter.' when filter has no results", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("snapshot-filter-input"), { target: { value: "zzznomatch" } });
    expect(screen.getByTestId("snapshot-empty")).toHaveTextContent("No snapshots match the filter.");
  });

  it("filters rows by query text", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("snapshot-filter-input"), { target: { value: "Before game" } });
    expect(screen.getAllByTestId("snapshot-row")).toHaveLength(1);
  });
});

describe("SnapshotManagerDialog – type filter", () => {
  it("filters rows when a type tab is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("snapshot-filter-type-basic"));
    expect(screen.getAllByTestId("snapshot-row")).toHaveLength(1);
  });

  it("shows all rows when 'All' tab is active", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("snapshot-filter-type-basic"));
    fireEvent.click(screen.getByTestId("snapshot-filter-type-all"));
    expect(screen.getAllByTestId("snapshot-row")).toHaveLength(SNAPSHOTS.length);
  });
});

describe("SnapshotManagerDialog – close", () => {
  it("close button calls onOpenChange(false)", () => {
    const { onOpenChange } = renderDialog();
    // Radix also renders an X icon button with sr-only text "Close", so we pick
    // the footer button (the one without an SVG child).
    const closeBtn = screen.getAllByRole("button", { name: "Close" }).find((btn) => !btn.querySelector("svg"))!;
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
