import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type React from "react";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    endReached,
    components,
    context,
    scrollerRef,
  }: {
    data: Array<{ id: string }>;
    endReached?: () => void;
    components?: {
      Header?: React.ComponentType<{ context?: unknown }>;
      EmptyPlaceholder?: React.ComponentType<{ context?: unknown }>;
    };
    context?: unknown;
    scrollerRef?: (element: HTMLElement | Window | null) => void;
  }) => {
    const Header = components?.Header;
    const EmptyPlaceholder = components?.EmptyPlaceholder;
    return (
      <div data-testid="virtuoso-mock" ref={(element) => scrollerRef?.(element)}>
        {Header ? <Header context={context} /> : null}
        {!data.length && EmptyPlaceholder ? <EmptyPlaceholder context={context} /> : null}
        <div data-testid="virtuoso-item-list">
          <button type="button" data-item-index="0">
            First row
          </button>
        </div>
        <span data-testid="virtuoso-count">{data.length}</span>
        <button type="button" onClick={() => endReached?.()}>
          Trigger end reached
        </button>
      </div>
    );
  },
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
  it("puts the playlist title and filter inside the virtual scroller and keeps the filter mounted while typing", () => {
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
          scrollViewAllHeader
        />
      </DisplayProfileProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const scroller = screen.getByTestId("virtuoso-mock");
    expect(within(scroller).getByRole("heading", { name: "Playlist" })).toBeInTheDocument();
    const filter = within(scroller).getByTestId("view-all-filter-input");
    fireEvent.change(filter, { target: { value: "Track 100" } });
    expect(within(scroller).getByTestId("view-all-filter-input")).toBe(filter);
    expect(filter).toHaveValue("Track 100");
    expect(within(scroller).getByTestId("virtuoso-count")).toHaveTextContent("2");
  });

  const lettered: ActionListItem[] = items.map((item, index) => ({
    ...item,
    title: `${String.fromCharCode(65 + (index % 26))} track ${index + 1}`,
  }));

  const renderScrollingHeaderList = () =>
    render(
      <DisplayProfileProvider>
        <SelectableActionList
          title="Playlist"
          items={lettered.slice(0, 20)}
          viewAllItems={lettered}
          totalItemCount={items.length}
          emptyLabel="No files"
          selectedCount={0}
          allSelected={false}
          onToggleSelectAll={vi.fn()}
          maxVisible={10}
          viewAllTitle="Playlist"
          scrollViewAllHeader
        />
      </DisplayProfileProvider>,
    );

  it("keeps the title and filter available when the filter matches no rows", () => {
    renderScrollingHeaderList();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const scroller = screen.getByTestId("virtuoso-mock");
    fireEvent.change(within(scroller).getByTestId("view-all-filter-input"), { target: { value: "no such track" } });

    expect(within(scroller).getByRole("heading", { name: "Playlist" })).toBeInTheDocument();
    expect(within(scroller).getByTestId("view-all-filter-input")).toHaveValue("no such track");
    expect(within(scroller).getByTestId("virtuoso-count")).toHaveTextContent("0");
  });

  it("keeps the letter rail below the part of the header still in view while the list scrolls", () => {
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(120);
    renderScrollingHeaderList();
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const scroller = screen.getByTestId("virtuoso-mock");
    const overlay = screen.getByTestId("alphabet-rail").parentElement as HTMLElement;

    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 50 });
    fireEvent.scroll(scroller);
    expect(overlay.style.top).toBe("70px");
    Object.defineProperty(scroller, "scrollTop", { configurable: true, value: 400 });
    fireEvent.scroll(scroller);
    expect(overlay.style.top).toBe("0px");
    clientHeight.mockRestore();
    offsetHeight.mockRestore();
  });

  it("folds the expanded filter when focus moves from it into the rows below the scrolling header", () => {
    render(
      <DisplayProfileProvider>
        <SelectableActionList
          title="Playlist"
          items={lettered.slice(0, 20)}
          viewAllItems={lettered}
          totalItemCount={lettered.length}
          emptyLabel="No files"
          selectedCount={0}
          allSelected={false}
          onToggleSelectAll={vi.fn()}
          maxVisible={10}
          viewAllTitle="Playlist"
          scrollViewAllHeader
          collapsibleFilterProfiles={["compact", "medium", "expanded"]}
        />
      </DisplayProfileProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const toggle = screen.getByTestId("view-all-filter-toggle");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    act(() => screen.getByRole("button", { name: "First row" }).focus());

    expect(screen.getByTestId("view-all-filter-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("reserves the card padding for the letter rail when the header stays pinned", () => {
    const clientHeight = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    render(
      <DisplayProfileProvider>
        <SelectableActionList
          title="Playlist"
          items={lettered.slice(0, 20)}
          viewAllItems={lettered}
          totalItemCount={lettered.length}
          emptyLabel="No files"
          selectedCount={0}
          allSelected={false}
          onToggleSelectAll={vi.fn()}
          maxVisible={10}
          viewAllTitle="Playlist"
        />
      </DisplayProfileProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    expect(screen.getByTestId("alphabet-rail")).toBeInTheDocument();
    clientHeight.mockRestore();
  });

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
