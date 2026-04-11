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
});
