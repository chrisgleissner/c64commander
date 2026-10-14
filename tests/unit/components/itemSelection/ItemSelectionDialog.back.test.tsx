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
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const navigator = vi.hoisted(() => ({
  path: "/music",
  isLoading: false,
  navigateUp: vi.fn(),
}));

vi.mock("@/lib/sourceNavigation/useSourceNavigator", () => ({
  useSourceNavigator: () => ({
    entries: [{ type: "dir", name: "Games", path: `${navigator.path}/Games` }],
    error: null,
    isLoading: navigator.isLoading,
    path: navigator.path,
    rootPath: "/music",
    navigateTo: vi.fn(),
    navigateUp: navigator.navigateUp,
    navigateRoot: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const sourceGroups: SourceGroup[] = [
  {
    label: "C64U",
    sources: [
      {
        id: "ultimate-1",
        type: "ultimate",
        name: "C64U",
        rootPath: "/music",
        isAvailable: true,
        listEntries: async () => [],
        listFilesRecursive: async () => [],
      },
    ],
  },
];

const openBrowserAt = async (path: string, isLoading = false) => {
  navigator.path = path;
  navigator.isLoading = isLoading;
  const onOpenChange = vi.fn();
  render(
    <DisplayProfileProvider>
      <ItemSelectionDialog
        open
        onOpenChange={onOpenChange}
        title="Add items"
        confirmLabel="Add to playlist"
        sourceGroups={sourceGroups}
        onAddLocalSource={async () => null}
        onConfirm={async () => true}
      />
    </DisplayProfileProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add file / folder from C64U" }));
  await waitFor(() => expect(screen.getByTestId("add-items-filter")).toBeVisible());
  return onOpenChange;
};

const pressBack = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

describe("ItemSelectionDialog Back key", () => {
  beforeEach(() => {
    navigator.navigateUp.mockReset();
  });

  it("goes up one folder from a sub-folder and keeps the browser open", async () => {
    const onOpenChange = await openBrowserAt("/music/Games");

    pressBack();

    expect(navigator.navigateUp).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes the browser at the source root", async () => {
    const onOpenChange = await openBrowserAt("/music");

    pressBack();

    expect(navigator.navigateUp).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("neither closes nor stacks a second move while a sub-folder is still loading", async () => {
    const onOpenChange = await openBrowserAt("/music/Games", true);

    pressBack();

    expect(navigator.navigateUp).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
