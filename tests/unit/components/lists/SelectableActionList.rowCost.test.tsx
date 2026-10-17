/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const virtuosoProps: { overscan?: number }[] = [];
const sheetMounts = { count: 0 };

vi.mock("react-virtuoso", () => ({
  Virtuoso: (props: { overscan?: number }) => {
    virtuosoProps.push({ overscan: props.overscan });
    return <div data-testid="virtuoso-mock" />;
  },
}));

vi.mock("@/components/ui/app-surface", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/app-surface")>();
  const CountedSheet = (props: React.ComponentProps<typeof actual.AppSheet>) => {
    React.useEffect(() => {
      sheetMounts.count += 1;
    }, []);
    return <actual.AppSheet {...props} />;
  };
  return { ...actual, AppSheet: CountedSheet };
});

import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const items: ActionListItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `item-${index}`,
  title: `Track ${index}`,
  selected: false,
  actionLabel: "Play",
  onAction: vi.fn(),
  menuItems: [{ type: "info", label: "Path", value: `/Usb0/Track ${index}.sid` }],
}));

const renderList = (width: number, extra: Partial<React.ComponentProps<typeof SelectableActionList>> = {}) => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  return render(
    <DisplayProfileProvider>
      <SelectableActionList
        title="Playlist"
        items={items}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={12}
        {...extra}
      />
    </DisplayProfileProvider>,
  );
};

describe("SelectableActionList row cost", () => {
  beforeEach(() => {
    virtuosoProps.length = 0;
    sheetMounts.count = 0;
  });

  it("builds a row's item sheet only once its actions button has been used", async () => {
    renderList(320);
    expect(screen.getAllByRole("button", { name: "Item actions" })).toHaveLength(12);
    expect(sheetMounts.count).toBe(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Item actions" })[3]);

    await waitFor(() => expect(sheetMounts.count).toBe(1));
    expect(screen.getByTestId("action-list-item-sheet")).toBeInTheDocument();
  });

  it("renders fewer rows beyond the viewport on the compact screen than on a wide one", () => {
    const viewAll = { viewAllTitle: "All tracks", viewAllItems: items, maxVisible: 5 };
    const compact = renderList(320, viewAll);
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const compactOverscan = virtuosoProps.at(-1)?.overscan;
    compact.unmount();
    virtuosoProps.length = 0;

    renderList(1280, viewAll);
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const wideOverscan = virtuosoProps.at(-1)?.overscan;

    expect(compactOverscan).toBe(200);
    expect(wideOverscan).toBe(500);
  });
});
