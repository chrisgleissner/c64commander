import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, endReached }: { data: Array<{ id: string }>; endReached?: () => void }) => (
    <div data-testid="virtuoso-mock">
      <span data-testid="virtuoso-count">{data.length}</span>
      <button type="button" onClick={() => endReached?.()}>
        Trigger end reached
      </button>
    </div>
  ),
}));

import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const items: ActionListItem[] = Array.from({ length: 1000 }, (_, index) => ({
  id: `item-${index + 1}`,
  title: `Track ${index + 1}`,
  selected: false,
  actionLabel: "Play",
  onSelectToggle: vi.fn(),
  onAction: vi.fn(),
}));

describe("SelectableActionList virtualization", () => {
  it("keeps the view-all path wired to the virtual list and incremental loading callbacks", () => {
    const onViewAllEndReached = vi.fn();

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
          viewAllTitle="All tracks"
          hasMoreViewAllItems
          onViewAllEndReached={onViewAllEndReached}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    expect(screen.getByTestId("virtuoso-count")).toHaveTextContent("1000");

    fireEvent.click(screen.getByRole("button", { name: "Trigger end reached" }));

    expect(onViewAllEndReached).toHaveBeenCalledTimes(1);
  });
});
