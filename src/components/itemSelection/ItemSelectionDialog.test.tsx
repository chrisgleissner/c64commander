import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ItemSelectionDialog, type SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";
import { DisplayProfileProvider, useDisplayProfilePreference } from "@/hooks/useDisplayProfile";

vi.mock("@/lib/sourceNavigation/useSourceNavigator", () => ({
  useSourceNavigator: () => ({
    entries: [
      { type: "file", name: "Alpha.sid", path: "/music/Alpha.sid" },
      { type: "file", name: "Beta.sid", path: "/music/Beta.sid" },
    ],
    error: null,
    isLoading: false,
    path: "/music",
    rootPath: "/music",
    openPath: vi.fn(),
    navigateUp: vi.fn(),
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

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const Harness = () => {
  const { setOverride } = useDisplayProfilePreference();
  return (
    <>
      <button type="button" onClick={() => setOverride("expanded")}>
        Expanded override
      </button>
      <ItemSelectionDialog
        open
        onOpenChange={() => undefined}
        title="Add items"
        confirmLabel="Add to playlist"
        sourceGroups={sourceGroups}
        onAddLocalSource={async () => null}
        onConfirm={async () => true}
      />
    </>
  );
};

describe("ItemSelectionDialog display profiles", () => {
  it("promotes to full-screen on compact and preserves selection/filter state when the profile changes", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <Harness />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add file / folder from C64U" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("inset-2");
    expect(dialog.className).not.toContain("w-screen");

    const filterInput = screen.getByPlaceholderText("Filter files…");
    fireEvent.change(filterInput, { target: { value: "Alpha" } });
    fireEvent.click(screen.getByLabelText("Select Alpha.sid"));

    act(() => {
      fireEvent.click(screen.getByText("Expanded override"));
    });

    expect(screen.getByPlaceholderText("Filter files…")).toHaveValue("Alpha");
    expect(screen.getByLabelText("Select Alpha.sid")).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("dialog").className).not.toContain("inset-[var(--display-profile-modal-inset)]");
  });
});
