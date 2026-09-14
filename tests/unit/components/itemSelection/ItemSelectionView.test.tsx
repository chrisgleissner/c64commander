import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemSelectionView } from "@/components/itemSelection/ItemSelectionView";

describe("ItemSelectionView", () => {
  it("opens a folder when the row container is clicked", () => {
    const onOpen = vi.fn();

    render(
      <ItemSelectionView
        path="/Usb0"
        rootPath="/"
        entries={[
          {
            type: "dir",
            name: "Games",
            path: "/Usb0/Games",
          },
        ]}
        isLoading={false}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onOpen={onOpen}
        onNavigateUp={vi.fn()}
        onNavigateRoot={vi.fn()}
        onRefresh={vi.fn()}
        showFolderSelect
        emptyLabel="No entries"
      />,
    );

    fireEvent.click(screen.getByTestId("source-entry-row"));

    expect(onOpen).toHaveBeenCalledWith("/Usb0/Games");
  });

  // The checkbox is 18 px. A tap just beside it landed on the row and opened the folder instead of
  // selecting it, so the checkbox sits in a 44 px target that selects.
  const renderFolder = (onToggleSelect = vi.fn(), onOpen = vi.fn()) => {
    render(
      <ItemSelectionView
        path="/Usb0"
        rootPath="/"
        entries={[{ type: "dir", name: "Games", path: "/Usb0/Games" }]}
        isLoading={false}
        selection={new Map()}
        onToggleSelect={onToggleSelect}
        onOpen={onOpen}
        onNavigateUp={vi.fn()}
        onNavigateRoot={vi.fn()}
        onRefresh={vi.fn()}
        showFolderSelect
        emptyLabel="No entries"
      />,
    );
    return { onToggleSelect, onOpen };
  };

  it("selects a folder from a tap beside its checkbox without opening it", () => {
    const { onToggleSelect, onOpen } = renderFolder();

    const target = screen.getByRole("checkbox", { name: "Select Games" }).parentElement as HTMLElement;
    expect(target).toHaveClass("h-11", "w-11");
    fireEvent.click(target);

    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("toggles once when the checkbox itself is tapped", () => {
    const { onToggleSelect, onOpen } = renderFolder();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Games" }));

    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not select a folder from the square around its checkbox when folders cannot be selected", () => {
    const onToggleSelect = vi.fn();
    render(
      <ItemSelectionView
        path="/Usb0"
        rootPath="/"
        entries={[{ type: "dir", name: "Games", path: "/Usb0/Games" }]}
        isLoading={false}
        selection={new Map()}
        onToggleSelect={onToggleSelect}
        onOpen={vi.fn()}
        onNavigateUp={vi.fn()}
        onNavigateRoot={vi.fn()}
        onRefresh={vi.fn()}
        showFolderSelect={false}
        emptyLabel="No entries"
      />,
    );

    const checkbox = screen.queryByRole("checkbox", { name: "Select Games" });
    if (checkbox) fireEvent.click(checkbox.parentElement as HTMLElement);

    expect(onToggleSelect).not.toHaveBeenCalled();
  });
});
