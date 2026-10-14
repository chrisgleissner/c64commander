import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemSelectionView, type GoUpOnBack } from "@/components/itemSelection/ItemSelectionView";
import { resetInputModality, setInputModality } from "@/lib/input";
import type { SourceEntry } from "@/lib/sourceNavigation/types";

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

  describe("focus after opening a folder", () => {
    afterEach(() => resetInputModality());

    const Browser = ({ path, entries, isLoading }: { path: string; entries: SourceEntry[]; isLoading: boolean }) => (
      <ItemSelectionView
        path={path}
        rootPath="/"
        entries={entries}
        isLoading={isLoading}
        selection={new Map()}
        onToggleSelect={vi.fn()}
        onOpen={vi.fn()}
        onNavigateUp={vi.fn()}
        onNavigateRoot={vi.fn()}
        onRefresh={vi.fn()}
        showFolderSelect={false}
        emptyLabel="No entries"
      />
    );
    const usb0: SourceEntry[] = [{ type: "dir", name: "Demos", path: "/Usb0/Demos" }];
    const demos: SourceEntry[] = [{ type: "dir", name: "Collection", path: "/Usb0/Demos/Collection" }];

    const openDemos = () => {
      const view = render(<Browser path="/Usb0" entries={usb0} isLoading={false} />);
      const open = screen.getByRole("button", { name: "Open Demos" });
      open.focus();
      fireEvent.click(open);
      view.rerender(<Browser path="/Usb0/Demos" entries={usb0} isLoading />);
      view.rerender(<Browser path="/Usb0/Demos" entries={demos} isLoading={false} />);
    };

    it("moves keypad focus to the opened folder's first entry", () => {
      setInputModality("key-navigation");
      openDemos();

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Collection" }));
    });

    it("leaves focus alone when the folder was opened by a key while focus was elsewhere", () => {
      setInputModality("key-navigation");
      const outside = document.createElement("button");
      document.body.appendChild(outside);
      const view = render(<Browser path="/Usb0" entries={usb0} isLoading={false} />);
      outside.focus();
      fireEvent.click(screen.getByRole("button", { name: "Open Demos" }));
      view.rerender(<Browser path="/Usb0/Demos" entries={demos} isLoading={false} />);

      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it("keeps focus on a control of the view that still holds it once the folder has loaded", () => {
      setInputModality("key-navigation");
      const view = render(<Browser path="/Usb0/Demos" entries={demos} isLoading={false} />);
      const refresh = screen.getByRole("button", { name: /refresh/i });
      refresh.focus();
      fireEvent.click(screen.getByRole("button", { name: /^up$/i }));
      view.rerender(<Browser path="/Usb0" entries={usb0} isLoading={false} />);

      expect(document.activeElement).toBe(refresh);
    });

    it("leaves focus alone when the folder was opened by touch", () => {
      setInputModality("pointer");
      openDemos();

      expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Open Collection" }));
    });
  });

  describe("Back key", () => {
    afterEach(() => resetInputModality());

    const renderAt = (path: string, entries: SourceEntry[], isLoading = false) => {
      const goUpOnBackRef = createRef<GoUpOnBack | null>() as { current: GoUpOnBack | null };
      const onNavigateUp = vi.fn();
      const view = render(
        <ItemSelectionView
          path={path}
          rootPath="/"
          entries={entries}
          isLoading={isLoading}
          selection={new Map()}
          onToggleSelect={vi.fn()}
          onOpen={vi.fn()}
          onNavigateUp={onNavigateUp}
          onNavigateRoot={vi.fn()}
          onRefresh={vi.fn()}
          showFolderSelect={false}
          emptyLabel="No entries"
          goUpOnBackRef={goUpOnBackRef}
        />,
      );
      return { goUpOnBackRef, onNavigateUp, view };
    };
    const games: SourceEntry[] = [{ type: "dir", name: "Arcade", path: "/Usb0/Games/Arcade" }];
    const usb0: SourceEntry[] = [{ type: "dir", name: "Games", path: "/Usb0/Games" }];

    it("goes up one folder from a sub-folder", () => {
      const { goUpOnBackRef, onNavigateUp } = renderAt("/Usb0/Games", games);

      expect(goUpOnBackRef.current?.()).toBe(true);
      expect(onNavigateUp).toHaveBeenCalledTimes(1);
    });

    it("leaves Back to close the browser at the root", () => {
      const { goUpOnBackRef, onNavigateUp } = renderAt("/", usb0);

      expect(goUpOnBackRef.current?.()).toBe(false);
      expect(onNavigateUp).not.toHaveBeenCalled();
    });

    it("takes Back without moving again while the folder is still loading", () => {
      const { goUpOnBackRef, onNavigateUp } = renderAt("/Usb0/Games", games, true);

      expect(goUpOnBackRef.current?.()).toBe(true);
      expect(onNavigateUp).not.toHaveBeenCalled();
    });

    it("moves keypad focus to the parent folder's first entry", () => {
      setInputModality("key-navigation");
      const { goUpOnBackRef, view } = renderAt("/Usb0/Games", games);
      screen.getByRole("button", { name: "Open Arcade" }).focus();

      goUpOnBackRef.current?.();
      view.rerender(
        <ItemSelectionView
          path="/Usb0"
          rootPath="/"
          entries={usb0}
          isLoading={false}
          selection={new Map()}
          onToggleSelect={vi.fn()}
          onOpen={vi.fn()}
          onNavigateUp={vi.fn()}
          onNavigateRoot={vi.fn()}
          onRefresh={vi.fn()}
          showFolderSelect={false}
          emptyLabel="No entries"
          goUpOnBackRef={goUpOnBackRef}
        />,
      );

      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open Games" }));
    });

    it("lets go of the handler when the view unmounts", () => {
      const { goUpOnBackRef, view } = renderAt("/Usb0/Games", games);
      view.unmount();

      expect(goUpOnBackRef.current).toBeNull();
    });

    it("gives every folder's Open button the full 44 px row height", () => {
      renderAt("/Usb0", usb0);

      expect(screen.getByRole("button", { name: "Open Games" }).className).toMatch(/\bmin-h-11\b/);
    });
  });
});
