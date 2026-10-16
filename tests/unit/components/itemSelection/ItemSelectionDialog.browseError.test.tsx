/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ItemSelectionDialog, type SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";
import { reportUserError } from "@/lib/uiErrors";

vi.mock("@/lib/uiErrors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uiErrors")>();
  return { ...actual, reportUserError: vi.fn() };
});

const UNREADABLE = "The C64 could not read /SD. Check that its storage is inserted and readable.";

const listEntries = vi.fn(async (path: string) => {
  if (path === "/SD") throw new Error(UNREADABLE);
  if (path === "/Temp") return [{ type: "file" as const, name: "game.d64", path: "/Temp/game.d64" }];
  return [
    { type: "dir" as const, name: "SD", path: "/SD" },
    { type: "dir" as const, name: "Temp", path: "/Temp" },
  ];
});

const sourceGroups: SourceGroup[] = [
  {
    label: "C64U",
    sources: [
      {
        id: "ultimate-browse-error",
        type: "ultimate",
        name: "C64U",
        rootPath: "/",
        isAvailable: true,
        listEntries,
        listFilesRecursive: async () => [],
      },
    ],
  },
];

const renderBrowser = (open: boolean) => (
  <ItemSelectionDialog
    open={open}
    onOpenChange={() => undefined}
    title="Add items"
    confirmLabel="Add to library"
    initialSourceId="ultimate-browse-error"
    sourceGroups={sourceGroups}
    onAddLocalSource={async () => null}
    onConfirm={async () => true}
  />
);

const openFolder = async (name: string) => {
  fireEvent.click(await screen.findByRole("button", { name: `Open ${name}` }));
};

describe("ItemSelectionDialog browse failures", () => {
  beforeEach(() => {
    localStorage.clear();
    listEntries.mockClear();
    vi.mocked(reportUserError).mockClear();
  });

  it("shows a folder that cannot be read inside the browser, not as a toast behind it", async () => {
    render(renderBrowser(true));
    await openFolder("SD");

    expect(await screen.findByRole("alert")).toHaveTextContent(UNREADABLE);
    expect(screen.getByTestId("item-selection-browse-error")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Temp" })).toBeVisible();
    expect(vi.mocked(reportUserError).mock.calls.filter(([report]) => report.operation === "BROWSE")).toEqual([]);
  });

  it("clears the message once a folder opens", async () => {
    render(renderBrowser(true));
    await openFolder("SD");
    await screen.findByRole("alert");

    await openFolder("Temp");

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByText("game.d64")).toBeVisible();
  });

  it("reopens at the last folder that worked, without the old failure", async () => {
    const view = render(renderBrowser(true));
    await openFolder("SD");
    await screen.findByRole("alert");

    view.rerender(renderBrowser(false));
    view.rerender(renderBrowser(true));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(await screen.findByRole("button", { name: "Open SD" })).toBeVisible();
    expect(listEntries.mock.calls.map(([path]) => path)).not.toContain("/SD/SD");
    expect(listEntries.mock.calls.filter(([path]) => path === "/SD")).toHaveLength(1);
    expect(Object.values({ ...localStorage })).not.toContain("/SD");
  });
});
