import { act, fireEvent, render, screen } from "@testing-library/react";
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

  it("promotes the browser to a sheet on compact and preserves selection/filter state when the profile changes", () => {
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
    expect(screen.getByRole("dialog")).toHaveAttribute("data-sheet-presentation", "modal");
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
    {
      label: "Assembly64",
      sources: [
        {
          id: "archive-assembly64",
          type: "assembly64",
          name: "Assembly64",
          rootPath: "/",
          isAvailable: true,
          listEntries: async () => [],
          listFilesRecursive: async () => [],
        },
      ],
    },
  ];

  it("renders CommoServe and Assembly64 buttons in the interstitial when sources are present", () => {
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
    expect(screen.getByTestId("import-option-assembly64")).toBeVisible();
    expect(screen.getByText("CommoServe")).toBeVisible();
    expect(screen.getByText("Assembly64")).toBeVisible();
    expect(screen.getByText("Online File Archive")).toBeVisible();
    expect(screen.getByText("Online Demo Archive")).toBeVisible();
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
    expect(screen.queryByTestId("import-option-assembly64")).not.toBeInTheDocument();
  });
});
