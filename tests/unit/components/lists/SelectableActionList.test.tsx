import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const items: ActionListItem[] = [
  {
    id: "item-1",
    title: "Alpha",
    selected: false,
    actionLabel: "Play",
    onSelectToggle: vi.fn(),
    onAction: vi.fn(),
  },
  {
    id: "item-2",
    title: "Beta",
    selected: false,
    actionLabel: "Play",
    onSelectToggle: vi.fn(),
    onAction: vi.fn(),
  },
];

describe("SelectableActionList", () => {
  it("reduces compact view-all inner spacing so list-browser popups stay proportionate", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <SelectableActionList
          title="Files"
          items={items}
          emptyLabel="No files"
          selectedCount={0}
          allSelected={false}
          onToggleSelectAll={vi.fn()}
          maxVisible={1}
          viewAllTitle="All files"
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    const root = screen.getByTestId("action-list-view-all");
    const header = root.firstElementChild;
    const body = root.children[1];
    const card = body?.firstElementChild;

    expect(header).toHaveClass("px-3");
    expect(body).toHaveClass("px-3");
    expect(card).toHaveClass("p-3");
  });

  it("keeps section headers while filtering and uses the shared view-all sheet", () => {
    localStorage.clear();
    setViewportWidth(1280);

    const sectionedItems: ActionListItem[] = [
      {
        id: "header-1",
        title: "Favorites",
        selected: false,
        actionLabel: "Play",
        variant: "header",
      },
      {
        id: "item-1",
        title: "Alpha",
        subtitle: "Favorite disk",
        filterText: "ultimate archive",
        selected: false,
        actionLabel: "Play",
        onSelectToggle: vi.fn(),
        onAction: vi.fn(),
      },
      {
        id: "item-2",
        title: "Beta",
        selected: false,
        actionLabel: "Play",
        onSelectToggle: vi.fn(),
        onAction: vi.fn(),
      },
    ];

    render(
      <DisplayProfileProvider>
        <SelectableActionList
          title="Files"
          items={sectionedItems}
          emptyLabel="No files"
          selectedCount={1}
          allSelected={true}
          onToggleSelectAll={vi.fn()}
          maxVisible={1}
          viewAllTitle="All files"
          rowTestId="file-row"
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByRole("button", { name: "Deselect all" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    expect(screen.getByText("All files")).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-app-surface", "sheet");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-sheet-presentation", "sheet");
    expect(screen.getByRole("dialog")).toHaveClass("rounded-t-[var(--interstitial-radius)]");

    fireEvent.change(screen.getByTestId("view-all-filter-input"), { target: { value: "archive" } });

    expect(screen.getByTestId("file-row-header")).toBeVisible();
    expect(screen.getByText("Alpha")).toBeVisible();

    fireEvent.change(screen.getByTestId("view-all-filter-input"), { target: { value: "no-match" } });

    expect(screen.getByText("No files")).toBeVisible();
  });

  it("uses the shared medium sheet presentation and clears both inline and view-all filters", () => {
    localStorage.clear();
    setViewportWidth(480);

    const onRemoveSelected = vi.fn();

    render(
      <DisplayProfileProvider>
        <SelectableActionList
          title="Files"
          items={items}
          emptyLabel="No files"
          selectedCount={1}
          allSelected={false}
          onToggleSelectAll={vi.fn()}
          onRemoveSelected={onRemoveSelected}
          removeSelectedLabel="Remove selected"
          maxVisible={1}
          viewAllTitle="All files"
          filterHeader={<div>Source filters</div>}
          headerActions={<button type="button">Refresh</button>}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByRole("button", { name: "Refresh" })).toBeVisible();
    expect(screen.getByText("Source filters")).toBeVisible();

    fireEvent.change(screen.getByTestId("list-filter-input"), { target: { value: "alp" } });
    expect(screen.getByRole("button", { name: "Clear filter" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByTestId("list-filter-input")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
    expect(onRemoveSelected).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "View all" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-app-surface", "sheet");
    expect(dialog).toHaveAttribute("data-sheet-presentation", "sheet");
    expect(dialog).toHaveClass("rounded-t-[var(--interstitial-radius)]");

    fireEvent.change(screen.getByTestId("view-all-filter-input"), { target: { value: "bet" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByTestId("view-all-filter-input")).toHaveValue("");
  });

  it("omits selection summary and view-all trigger when controls are disabled and the list fits", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <SelectableActionList
          title="Files"
          items={items}
          emptyLabel="No files"
          selectedCount={0}
          allSelected={false}
          onToggleSelectAll={vi.fn()}
          maxVisible={4}
          showSelectionControls={false}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.queryByText("No files selected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View all" })).not.toBeInTheDocument();
  });
});
