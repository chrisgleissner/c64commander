import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { SnapshotManagerDialog } from "@/pages/home/dialogs/SnapshotManagerDialog";
import type { SnapshotStorageEntry } from "@/lib/snapshot/snapshotTypes";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const snapshot: SnapshotStorageEntry = {
  id: "snapshot-1",
  filename: "snapshot-1.c64snap",
  bytesBase64: "AA==",
  createdAt: "2026-03-15T12:00:00.000Z",
  snapshotType: "program",
  metadata: {
    snapshot_type: "program",
    display_ranges: ["$0000-$00FF", "$0200-$FFFF"],
    created_at: "2026-03-15 12:00:00",
    label: "First snapshot",
  },
};

const unlabeledSnapshot: SnapshotStorageEntry = {
  ...snapshot,
  id: "snapshot-2",
  filename: "snapshot-2.c64snap",
  metadata: {
    ...snapshot.metadata,
    label: undefined,
  },
};

describe("SnapshotManagerDialog", () => {
  it("uses compact header and body spacing so the first row stays reachable in reduced-height sheets", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <SnapshotManagerDialog
          open
          onOpenChange={vi.fn()}
          snapshots={[snapshot]}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onUpdateLabel={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    const header = screen.getByText("Load RAM").closest("div[class*='border-b']");
    const headerRow = document.querySelector('[data-interstitial-header-row="true"]');
    const filters = screen.getByTestId("snapshot-type-filters").parentElement;
    const body = screen.getByTestId("snapshot-list");
    const description = screen.getByText("Select a snapshot to restore.");

    expect(header?.className).not.toContain("pr-12");
    expect(header?.className).not.toContain("pr-14");
    expect(headerRow).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" }).closest('[data-interstitial-header-row="true"]')).toBe(
      headerRow,
    );
    expect(filters?.className).toContain("space-y-2");
    expect(filters?.className).toContain("px-4");
    expect(filters?.className).toContain("py-3");
    expect(body.className).toContain("px-4");
    expect(body.className).toContain("py-3");
    expect(description.className).toContain("hidden");
  });

  it("keeps the roomier sheet spacing and visible description outside compact mode", () => {
    localStorage.clear();
    setViewportWidth(800);

    render(
      <DisplayProfileProvider>
        <SnapshotManagerDialog
          open
          onOpenChange={vi.fn()}
          snapshots={[snapshot]}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onUpdateLabel={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    const header = screen.getByText("Load RAM").closest("div[class*='border-b']");
    const headerRow = document.querySelector('[data-interstitial-header-row="true"]');
    const filters = screen.getByTestId("snapshot-type-filters").parentElement;
    const body = screen.getByTestId("snapshot-list");
    const description = screen.getByText("Select a snapshot to restore.");

    expect(header?.className).not.toContain("pr-12");
    expect(header?.className).not.toContain("pr-14");
    expect(headerRow).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" }).closest('[data-interstitial-header-row="true"]')).toBe(
      headerRow,
    );
    expect(filters?.className).toContain("space-y-3");
    expect(filters?.className).toContain("px-6");
    expect(filters?.className).toContain("py-4");
    expect(body.className).toContain("px-6");
    expect(body.className).toContain("py-4");
    expect(description.className).not.toContain("hidden");
  });

  it("distinguishes empty libraries from empty filter results", () => {
    localStorage.clear();
    setViewportWidth(360);

    const { rerender } = render(
      <DisplayProfileProvider>
        <SnapshotManagerDialog
          open
          onOpenChange={vi.fn()}
          snapshots={[]}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onUpdateLabel={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("snapshot-empty")).toHaveTextContent("No snapshots saved yet.");

    rerender(
      <DisplayProfileProvider>
        <SnapshotManagerDialog
          open
          onOpenChange={vi.fn()}
          snapshots={[snapshot]}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onUpdateLabel={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.change(screen.getByTestId("snapshot-filter-input"), {
      target: { value: "missing" },
    });

    expect(screen.getByTestId("snapshot-empty")).toHaveTextContent("No snapshots match the filter.");
  });

  it("handles restore, inline comment editing, and delete actions on snapshot rows", () => {
    localStorage.clear();
    setViewportWidth(360);
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    const onUpdateLabel = vi.fn();

    render(
      <DisplayProfileProvider>
        <SnapshotManagerDialog
          open
          onOpenChange={vi.fn()}
          snapshots={[unlabeledSnapshot]}
          onRestore={onRestore}
          onDelete={onDelete}
          onUpdateLabel={onUpdateLabel}
        />
      </DisplayProfileProvider>,
    );

    const row = screen.getByTestId("snapshot-row");
    fireEvent.keyDown(row, { key: "Enter", target: row, currentTarget: row });
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "snapshot-2" }));

    fireEvent.click(screen.getByRole("button", { name: "Add snapshot comment" }));
    const input = screen.getByLabelText("Snapshot comment");
    fireEvent.change(input, { target: { value: "Updated comment" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onUpdateLabel).toHaveBeenCalledWith("snapshot-2", "Updated comment");
    expect(onRestore).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("snapshot-delete"));
    expect(onDelete).toHaveBeenCalledWith("snapshot-2");
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("uses the expanded comment editor layout and closes it on Escape", () => {
    localStorage.clear();
    setViewportWidth(800);
    const onUpdateLabel = vi.fn();

    render(
      <DisplayProfileProvider>
        <SnapshotManagerDialog
          open
          onOpenChange={vi.fn()}
          snapshots={[unlabeledSnapshot]}
          onRestore={vi.fn()}
          onDelete={vi.fn()}
          onUpdateLabel={onUpdateLabel}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add snapshot comment" }));

    const editorLayout = screen.getByLabelText("Snapshot comment").closest("div[class*='grid']");
    expect(editorLayout?.className).toContain("grid-cols-[minmax(0,1fr)_auto_auto]");

    const input = screen.getByLabelText("Snapshot comment");
    fireEvent.change(input, { target: { value: "Transient note" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onUpdateLabel).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Snapshot comment")).not.toBeInTheDocument();
  });
});
