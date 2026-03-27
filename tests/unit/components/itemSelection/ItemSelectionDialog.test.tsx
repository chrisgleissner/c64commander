import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/components/itemSelection/ArchiveSelectionView", () => ({
  archiveResultKey: (result: { id: string; category: number }) => `${result.id}:${result.category}`,
  ArchiveSelectionView: ({ selection, onToggleSelect, onSelectAll, onClearSelection }: any) => (
    <div data-testid="archive-selection-view-mock">
      <div data-testid="archive-selection-size">{selection.size}</div>
      <button type="button" onClick={() => onToggleSelect({ id: "100", category: 40, name: "Demo" })}>
        Toggle archive result
      </button>
      <button
        type="button"
        onClick={() =>
          onSelectAll([
            { id: "100", category: 40, name: "Demo" },
            { id: "101", category: 41, name: "Second Demo" },
          ])
        }
      >
        Select all archive results
      </button>
      <button type="button" onClick={() => onClearSelection()}>
        Clear archive selection
      </button>
    </div>
  ),
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

const MediumHarness = () => {
  const { setOverride } = useDisplayProfilePreference();

  return (
    <>
      <button type="button" onClick={() => setOverride("medium")}>
        Medium override
      </button>
      <ItemSelectionDialog
        open
        onOpenChange={() => undefined}
        title="Add items"
        confirmLabel="Add to playlist"
        sourceGroups={[
          {
            label: "Sources",
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
              {
                id: "hvsc-1",
                type: "hvsc",
                name: "HVSC",
                rootPath: "/hvsc",
                isAvailable: true,
                listEntries: async () => [],
                listFilesRecursive: async () => [],
              },
            ],
          },
        ]}
        onAddLocalSource={async () => null}
        onConfirm={async () => true}
      />
    </>
  );
};

describe("ItemSelectionDialog display profiles", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("keeps the browser as a sheet across profile changes while preserving selection and filter state", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <Harness />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add file / folder from C64U" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-app-surface", "sheet");
    expect(dialog).toHaveAttribute("data-sheet-presentation", "sheet");
    expect(screen.getByTestId("add-items-filter").closest('[data-testid="add-items-scroll"]')).toBeNull();

    const filterInput = screen.getByPlaceholderText("Filter files…");
    fireEvent.change(filterInput, { target: { value: "Alpha" } });
    fireEvent.click(screen.getByLabelText("Select Alpha.sid"));

    act(() => {
      fireEvent.click(screen.getByText("Expanded override"));
    });

    expect(screen.getByPlaceholderText("Filter files…")).toHaveValue("Alpha");
    expect(screen.getByLabelText("Select Alpha.sid")).toHaveAttribute("data-state", "checked");
    expect(screen.getByRole("dialog")).toHaveAttribute("data-sheet-presentation", "sheet");
  });

  it("keeps the source selector as a compact decision dialog before a source is chosen", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={sourceGroups}
          onAddLocalSource={async () => null}
          onConfirm={async () => true}
        />
      </DisplayProfileProvider>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("data-app-surface", "dialog");
    expect(screen.getByTestId("import-selection-interstitial")).toBeVisible();
    expect(screen.getByText("Select items to add from a specific source.")).toBeVisible();
  });

  it("stacks medium interstitial source buttons with equal full width", () => {
    localStorage.clear();
    setViewportWidth(768);

    render(
      <DisplayProfileProvider>
        <MediumHarness />
      </DisplayProfileProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByText("Medium override"));
    });

    const interstitial = screen.getByTestId("import-selection-interstitial");
    expect(interstitial.className).toContain("grid-cols-1");
    expect(screen.getByTestId("import-option-local").className).toContain("w-full");
    expect(screen.getByTestId("import-option-c64u").className).toContain("w-full");
    expect(screen.getByTestId("import-option-hvsc").className).toContain("w-full");
    expect(screen.getByText("High Voltage SID Collection").className).toContain("whitespace-normal");
  });

  it("shows the selected C64U identifier in the selection heading", async () => {
    localStorage.clear();

    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={[
            {
              label: "Sources",
              sources: [
                {
                  id: "ultimate-custom",
                  type: "ultimate",
                  name: "U64E2",
                  rootPath: "/music",
                  isAvailable: true,
                  listEntries: async () => [],
                  listFilesRecursive: async () => [],
                },
              ],
            },
          ]}
          onAddLocalSource={async () => null}
          onConfirm={async () => true}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("import-option-c64u"));

    expect(await screen.findByText("Select items from U64E2")).toBeVisible();
  });

  it("shows the local device label in the selection heading", async () => {
    localStorage.clear();

    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={[
            {
              label: "Sources",
              sources: [
                {
                  id: "local-1",
                  type: "local",
                  name: "Music",
                  rootPath: "/music",
                  isAvailable: true,
                  listEntries: async () => [],
                  listFilesRecursive: async () => [],
                },
              ],
            },
          ]}
          onAddLocalSource={async () => "local-1"}
          onConfirm={async () => true}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("import-option-local"));

    await waitFor(() => {
      expect(screen.getByText("Select items from Local Device")).toBeVisible();
    });
  });
});

describe("ItemSelectionDialog archive source buttons", () => {
  const archiveSourceGroups: SourceGroup[] = [
    {
      label: "C64U",
      sources: [
        {
          id: "ultimate-1",
          type: "ultimate",
          name: "C64U",
          rootPath: "/",
          isAvailable: true,
          listEntries: async () => [],
          listFilesRecursive: async () => [],
        },
      ],
    },
    {
      label: "CommoServe",
      sources: [
        {
          id: "archive-commoserve",
          type: "commoserve",
          name: "CommoServe",
          rootPath: "/",
          isAvailable: true,
          listEntries: async () => [],
          listFilesRecursive: async () => [],
        },
      ],
    },
  ];

  it("renders the CommoServe button in the interstitial when the source is present", () => {
    localStorage.clear();
    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={archiveSourceGroups}
          onAddLocalSource={async () => null}
          onConfirm={async () => true}
        />
      </DisplayProfileProvider>,
    );
    expect(screen.getByTestId("import-option-commoserve")).toBeVisible();
    expect(screen.getByText("CommoServe")).toBeVisible();
    expect(screen.getByText("Online File Archive")).toBeVisible();
  });

  it("omits archive buttons when sources are absent", () => {
    localStorage.clear();
    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={sourceGroups}
          onAddLocalSource={async () => null}
          onConfirm={async () => true}
        />
      </DisplayProfileProvider>,
    );
    expect(screen.queryByTestId("import-option-commoserve")).not.toBeInTheDocument();
  });

  it("confirms archive selections using archive result identifiers", async () => {
    const onConfirm = vi.fn(async () => true);

    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={archiveSourceGroups}
          onAddLocalSource={async () => null}
          onConfirm={onConfirm}
          archiveConfigs={{
            "archive-commoserve": {
              id: "archive-commoserve",
              name: "CommoServe",
              baseUrl: "http://commoserve.files.commodore.net",
              enabled: true,
            },
          }}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("import-option-commoserve"));
    fireEvent.click(screen.getByText("Toggle archive result"));
    fireEvent.click(screen.getByTestId("add-items-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: "archive-commoserve", type: "commoserve" }), [
      { type: "file", name: "Demo", path: "100/40" },
    ]);
  });

  it("updates archive selection count for select-all and clear actions", () => {
    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={archiveSourceGroups}
          onAddLocalSource={async () => null}
          onConfirm={async () => true}
          archiveConfigs={{
            "archive-commoserve": {
              id: "archive-commoserve",
              name: "CommoServe",
              baseUrl: "http://commoserve.files.commodore.net",
              enabled: true,
            },
          }}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("import-option-commoserve"));
    expect(screen.getByTestId("archive-selection-size")).toHaveTextContent("0");

    fireEvent.click(screen.getByText("Select all archive results"));
    expect(screen.getByTestId("archive-selection-size")).toHaveTextContent("2");
    expect(screen.getByTestId("add-items-selection-count")).toHaveTextContent("2 selected");

    fireEvent.click(screen.getByText("Clear archive selection"));
    expect(screen.getByTestId("archive-selection-size")).toHaveTextContent("0");
  });

  it("shows the HVSC source label in the selection heading", async () => {
    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={[
            {
              label: "Sources",
              sources: [
                {
                  id: "hvsc-1",
                  type: "hvsc",
                  name: "HVSC library",
                  rootPath: "/hvsc",
                  isAvailable: true,
                  listEntries: async () => [],
                  listFilesRecursive: async () => [],
                },
                {
                  id: "archive-commoserve",
                  type: "commoserve",
                  name: "CommoServe",
                  rootPath: "/",
                  isAvailable: true,
                  listEntries: async () => [],
                  listFilesRecursive: async () => [],
                },
              ],
            },
          ]}
          onAddLocalSource={async () => null}
          onConfirm={async () => true}
          archiveConfigs={{
            "archive-commoserve": {
              id: "archive-commoserve",
              name: "CommoServe",
              baseUrl: "http://commoserve.files.commodore.net",
              enabled: true,
            },
          }}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("import-option-hvsc"));
    expect(await screen.findByText("Select items from HVSC")).toBeVisible();
  });

  it("shows the CommoServe source label in the selection heading", async () => {
    render(
      <DisplayProfileProvider>
        <ItemSelectionDialog
          open
          onOpenChange={() => undefined}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={archiveSourceGroups}
          onAddLocalSource={async () => null}
          onConfirm={async () => true}
          archiveConfigs={{
            "archive-commoserve": {
              id: "archive-commoserve",
              name: "CommoServe",
              baseUrl: "http://commoserve.files.commodore.net",
              enabled: true,
            },
          }}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("import-option-commoserve"));
    expect(await screen.findByText("Select items from CommoServe")).toBeVisible();
  });
});
