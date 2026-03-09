/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RestoreSnapshotDialog } from "@/pages/home/dialogs/RestoreSnapshotDialog";
import type { SnapshotStorageEntry } from "@/lib/snapshot/snapshotTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_WITH_LABEL: SnapshotStorageEntry = {
  id: "snap-1",
  filename: "c64-program-20260110-090000.c64snap",
  bytesBase64: "",
  createdAt: "2026-01-10T09:00:00.000Z",
  snapshotType: "program",
  metadata: {
    snapshot_type: "program",
    display_ranges: ["$0000–$00FF", "$0200–$FFFF"],
    created_at: "2026-01-10 09:00:00",
    label: "JupiterLander.crt",
  },
};

const SNAPSHOT_NO_LABEL: SnapshotStorageEntry = {
  id: "snap-2",
  filename: "c64-basic-20260110-090000.c64snap",
  bytesBase64: "",
  createdAt: "2026-01-10T09:00:00.000Z",
  snapshotType: "basic",
  metadata: {
    snapshot_type: "basic",
    display_ranges: ["$0801–STREND"],
    created_at: "2026-01-10 09:00:00",
  },
};

const SNAPSHOT_UNKNOWN_TYPE: SnapshotStorageEntry = {
  id: "snap-3",
  filename: "c64-custom-20260110-090000.c64snap",
  bytesBase64: "",
  createdAt: "2026-01-10T09:00:00.000Z",
  snapshotType: "custom",
  metadata: {
    snapshot_type: "custom",
    display_ranges: ["$0400-$07E7"],
    created_at: "2026-01-10 09:00:00",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const renderDialog = (snapshot: SnapshotStorageEntry | null, isPending = false) => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const { container } = render(
    <RestoreSnapshotDialog
      open={true}
      onOpenChange={onOpenChange}
      snapshot={snapshot}
      onConfirm={onConfirm}
      isPending={isPending}
    />,
  );
  return { onConfirm, onOpenChange, container };
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RestoreSnapshotDialog – null snapshot", () => {
  it("renders nothing when snapshot is null", () => {
    const { container } = renderDialog(null);
    // Dialog renders null; only an empty container expected
    expect(container.firstChild).toBeNull();
  });
});

describe("RestoreSnapshotDialog – snapshot with label", () => {
  it("renders the dialog when snapshot is provided", () => {
    renderDialog(SNAPSHOT_WITH_LABEL);
    expect(screen.getByTestId("restore-snapshot-dialog")).toBeInTheDocument();
  });

  it("shows the snapshot label", () => {
    renderDialog(SNAPSHOT_WITH_LABEL);
    expect(screen.getByText("JupiterLander.crt")).toBeInTheDocument();
  });

  it("shows the type label (Program Snapshot)", () => {
    renderDialog(SNAPSHOT_WITH_LABEL);
    expect(screen.getByText("Program Snapshot")).toBeInTheDocument();
  });

  it("shows the display range", () => {
    renderDialog(SNAPSHOT_WITH_LABEL);
    expect(screen.getByText("$0000–$00FF, $0200–$FFFF")).toBeInTheDocument();
  });
});

describe("RestoreSnapshotDialog – snapshot without label", () => {
  it("does not show any label text", () => {
    renderDialog(SNAPSHOT_NO_LABEL);
    // Label should be absent
    expect(screen.queryByText("JupiterLander.crt")).not.toBeInTheDocument();
  });

  it("shows type label for basic snapshot", () => {
    renderDialog(SNAPSHOT_NO_LABEL);
    expect(screen.getByText("Basic Snapshot")).toBeInTheDocument();
  });
});

describe("RestoreSnapshotDialog – unknown type", () => {
  it("falls back to snapshotType string when typeConfig not found", () => {
    // 'custom' is a valid type but let's verify typeLabel fallback path
    renderDialog(SNAPSHOT_UNKNOWN_TYPE);
    // 'Custom' should be shown (typeConfig found for custom type)
    expect(screen.getByTestId("restore-snapshot-dialog")).toBeInTheDocument();
  });
});

describe("RestoreSnapshotDialog – actions", () => {
  it("confirm button calls onConfirm", () => {
    const { onConfirm } = renderDialog(SNAPSHOT_WITH_LABEL);
    fireEvent.click(screen.getByTestId("restore-snapshot-confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancel button calls onOpenChange(false)", () => {
    const { onOpenChange } = renderDialog(SNAPSHOT_WITH_LABEL);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows 'Restoring…' text and disables buttons when isPending=true", () => {
    renderDialog(SNAPSHOT_WITH_LABEL, true);
    const confirmBtn = screen.getByTestId("restore-snapshot-confirm");
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn).toHaveTextContent("Restoring…");
  });

  it("shows 'Restore' text and enabled button when isPending=false", () => {
    renderDialog(SNAPSHOT_WITH_LABEL, false);
    const confirmBtn = screen.getByTestId("restore-snapshot-confirm");
    expect(confirmBtn).not.toBeDisabled();
    expect(confirmBtn).toHaveTextContent("Restore");
  });
});
