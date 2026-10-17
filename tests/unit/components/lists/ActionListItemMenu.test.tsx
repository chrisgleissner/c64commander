/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { groupItemMenuEntries, orderActionsFirst } from "@/components/lists/ActionListItemMenu";
import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
};

const buildItem = (overrides: Partial<ActionListItem> = {}): ActionListItem => ({
  id: "track-1",
  title: "Commando.sid",
  selected: false,
  actionLabel: "Play",
  onAction: vi.fn(),
  onRowClick: vi.fn(),
  menuItems: [
    { type: "label", label: "Details" },
    { type: "info", label: "Type", value: "SID music" },
    { type: "info", label: "Path", value: "/Usb0/Music/Hubbard/Commando.sid" },
    { type: "separator" },
    { type: "label", label: "Config" },
    { type: "info", label: "Attached", value: "None" },
    { type: "action", label: "Review playback config", onSelect: vi.fn() },
    { type: "action", label: "Attach local .cfg", onSelect: vi.fn() },
  ],
  ...overrides,
});

const renderList = (item: ActionListItem, width: number) => {
  localStorage.clear();
  setViewportWidth(width);
  return render(
    <DisplayProfileProvider>
      <SelectableActionList
        title="Playlist"
        items={[item]}
        emptyLabel="Empty"
        selectedCount={0}
        allSelected={false}
        onToggleSelectAll={vi.fn()}
        maxVisible={10}
        rowTestId="playlist-item"
      />
    </DisplayProfileProvider>,
  );
};

const openSheet = async () => {
  const trigger = screen.getByRole("button", { name: "Item actions" });
  fireEvent.click(trigger);
  return within(await screen.findByTestId("action-list-item-sheet"));
};

afterEach(() => {
  setViewportWidth(1024);
});

describe("groupItemMenuEntries", () => {
  it("keeps each labelled run of details together and gathers the actions that follow them", () => {
    const blocks = groupItemMenuEntries(buildItem().menuItems!);
    expect(blocks.map((block) => (block.kind === "details" ? `details:${block.label}` : "actions"))).toEqual([
      "details:Details",
      "details:Config",
      "actions",
    ]);
    expect(blocks[0]).toMatchObject({ rows: [{ label: "Type" }, { label: "Path" }] });
  });

  it("drops a label with no details under it", () => {
    expect(groupItemMenuEntries([{ type: "label", label: "Empty" }, { type: "separator" }])).toEqual([]);
  });
});

describe("orderActionsFirst", () => {
  it("moves actions ahead of every details block and keeps the details together", () => {
    const ordered = orderActionsFirst(buildItem().menuItems!);
    expect(
      ordered.map((entry) => (entry.type === "action" || entry.type === "label" ? entry.label : entry.type)),
    ).toEqual([
      "Review playback config",
      "Attach local .cfg",
      "separator",
      "Details",
      "info",
      "info",
      "separator",
      "Config",
      "info",
    ]);
  });

  it("adds no leading separator when there are no actions", () => {
    expect(orderActionsFirst([{ type: "info", label: "Type", value: "SID" }])[0]).toMatchObject({ type: "info" });
  });
});

describe("a list row's item actions on the compact profile", () => {
  it("open as a sheet titled with the item's name rather than as a menu", async () => {
    renderList(buildItem(), 320);
    const sheet = await openSheet();
    expect(screen.getByRole("dialog", { name: "Commando.sid" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(sheet.getByRole("heading", { name: "Details" })).toBeInTheDocument();
  });

  it("show every detail with its full value and every action", async () => {
    renderList(buildItem(), 320);
    const sheet = await openSheet();
    expect(sheet.getByText("Type")).toBeInTheDocument();
    expect(sheet.getByText("SID music")).toBeInTheDocument();
    expect(sheet.getAllByTestId("action-list-item-sheet-details").map((section) => section.textContent ?? "")).toEqual([
      "DetailsTypeSID musicPath/Usb0/Music/Hubbard/Commando.sid",
      "ConfigAttachedNone",
    ]);
    expect(sheet.getByRole("button", { name: "Review playback config" })).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "Attach local .cfg" })).toBeInTheDocument();
  });

  it("list the actions before the details so a short sheet shows them without scrolling", async () => {
    renderList(buildItem(), 320);
    const sheet = await openSheet();
    const action = sheet.getByRole("button", { name: "Review playback config" });
    const details = sheet.getAllByTestId("action-list-item-sheet-details")[0];
    expect(action.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("make each detail row a stop the keypad can step to", async () => {
    renderList(buildItem(), 320);
    const sheet = await openSheet();
    const rows = sheet.getAllByTestId("action-list-item-sheet-detail-row");
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveAttribute("tabindex", "0");
  });

  it("open on the play button, the first control shown, not on the first menu action below it", async () => {
    renderList(buildItem(), 320);
    const sheet = await openSheet();
    await waitFor(() => expect(sheet.getByTestId("action-list-item-sheet-primary")).toHaveFocus());
  });

  it("open on the first action when the play button is unavailable", async () => {
    renderList(buildItem({ isDimmed: true }), 320);
    const sheet = await openSheet();
    await waitFor(() => expect(sheet.getByRole("button", { name: "Review playback config" })).toHaveFocus());
  });

  it("open on the first detail row when the item has neither a play button nor actions", async () => {
    const item = buildItem({
      onAction: undefined,
      menuItems: [
        { type: "label", label: "Details" },
        { type: "info", label: "Type", value: "SID music" },
      ],
    });
    renderList(item, 320);
    const sheet = await openSheet();
    await waitFor(() => expect(sheet.getByTestId("action-list-item-sheet-detail-row")).toHaveFocus());
  });

  it("play the item from the sheet in one press, and close the sheet", async () => {
    const item = buildItem();
    renderList(item, 320);
    const sheet = await openSheet();
    fireEvent.click(sheet.getByTestId("action-list-item-sheet-primary"));
    expect(item.onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("action-list-item-sheet")).not.toBeInTheDocument());
  });

  it("run an action and close the sheet", async () => {
    const item = buildItem();
    renderList(item, 320);
    const sheet = await openSheet();
    fireEvent.click(sheet.getByRole("button", { name: "Review playback config" }));
    const review = item.menuItems!.find((entry) => entry.type === "action")!;
    expect(review.type === "action" && review.onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("action-list-item-sheet")).not.toBeInTheDocument());
  });

  it("do not play the item when the reader taps the sheet's text", async () => {
    const item = buildItem();
    renderList(item, 320);
    const sheet = await openSheet();
    fireEvent.click(sheet.getByText("SID music"));
    expect(item.onRowClick).not.toHaveBeenCalled();
    expect(item.onAction).not.toHaveBeenCalled();
  });

  it("close on Back and hand focus back to the button that opened them", async () => {
    renderList(buildItem(), 320);
    const trigger = screen.getByRole("button", { name: "Item actions" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const sheet = await screen.findByTestId("action-list-item-sheet");
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("action-list-item-sheet")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("disable the sheet's play button while the row's actions are unavailable", async () => {
    renderList(buildItem({ isDimmed: true }), 320);
    const sheet = await openSheet();
    expect(sheet.getByTestId("action-list-item-sheet-primary")).toBeDisabled();
  });
});

describe("a list row's item actions on larger profiles", () => {
  it("stay a menu beside the row", async () => {
    renderList(buildItem(), 1024);
    const trigger = screen.getByRole("button", { name: "Item actions" });
    await act(async () => {
      fireEvent.pointerDown(trigger);
      fireEvent.click(trigger);
    });
    expect(screen.queryByTestId("action-list-item-sheet")).not.toBeInTheDocument();
    expect(document.body.textContent).toContain("Review playback config");
    const items = screen.getAllByRole("menuitem").map((entry) => entry.textContent ?? "");
    expect(items.findIndex((text) => text.includes("Review playback config"))).toBeLessThan(
      items.findIndex((text) => text.startsWith("Type")),
    );
  });
});
