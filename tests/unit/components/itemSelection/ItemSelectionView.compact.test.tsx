/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ItemSelectionView } from "@/components/itemSelection/ItemSelectionView";

vi.mock("@/hooks/useDisplayProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useDisplayProfile")>()),
  useDisplayProfile: () => ({ profile: "compact" }),
}));

const renderAt = (path: string, handlers: { up?: () => void; root?: () => void; refresh?: () => void } = {}) =>
  render(
    <ItemSelectionView
      path={path}
      rootPath="/"
      entries={[]}
      isLoading={false}
      selection={new Map()}
      onToggleSelect={vi.fn()}
      onOpen={vi.fn()}
      onNavigateUp={handlers.up ?? vi.fn()}
      onNavigateRoot={handlers.root ?? vi.fn()}
      onRefresh={handlers.refresh ?? vi.fn()}
      showFolderSelect
      emptyLabel="No entries"
    />,
  );

describe("ItemSelectionView on the smallest screen", () => {
  it("puts Up, Root and Refresh on one row of named 44 px icon buttons that act", () => {
    const up = vi.fn();
    const root = vi.fn();
    const refresh = vi.fn();
    renderAt("/Usb0/Games", { up, root, refresh });

    fireEvent.click(screen.getByRole("button", { name: "Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Root" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(up).toHaveBeenCalledOnce();
    expect(root).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Up" })).toHaveClass("h-11", "w-11");
  });

  it("disables Up and Root at the top of the source", () => {
    renderAt("/");

    expect(screen.getByRole("button", { name: "Up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Root" })).toBeDisabled();
  });
});
