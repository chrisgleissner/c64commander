/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const scrollToIndex = vi.hoisted(() => vi.fn());

vi.mock("react-virtuoso", () => ({
  Virtuoso: React.forwardRef(function VirtuosoMock(
    { data }: { data: Array<{ id: string }> },
    ref: React.ForwardedRef<{ scrollToIndex: typeof scrollToIndex }>,
  ) {
    React.useImperativeHandle(ref, () => ({ scrollToIndex }));
    return <span data-testid="virtuoso-count">{data.length}</span>;
  }),
}));

import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import { revealListRow } from "@/components/lists/listRowReveal";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const items: ActionListItem[] = Array.from({ length: 40 }, (_, index) => ({
  id: `item-${index + 1}`,
  title: `Track ${index + 1}`,
  selected: false,
  actionLabel: "Play",
  onSelectToggle: vi.fn(),
  onAction: vi.fn(),
}));

const renderList = () =>
  render(
    <DisplayProfileProvider>
      <SelectableActionList
        title="Playlist"
        items={items.slice(0, 20)}
        viewAllItems={items}
        totalItemCount={items.length}
        emptyLabel="No files"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        viewAllTitle="Playlist"
      />
    </DisplayProfileProvider>,
  );

describe("SelectableActionList registers its View all list with the row reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scrollToIndex.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrolls a row that is not rendered to the centre of the list, by its position in the list", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    const revealed = revealListRow("item-25");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    expect(scrollToIndex).toHaveBeenCalledWith({ index: 24, align: "center" });
    await expect(revealed).resolves.toBeNull();
  });

  it("does not scroll for a row the list does not hold, and answers at once", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    await expect(revealListRow("item-999")).resolves.toBeNull();

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("stops answering for rows once View all is closed", async () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    await expect(revealListRow("item-25")).resolves.toBeNull();

    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
