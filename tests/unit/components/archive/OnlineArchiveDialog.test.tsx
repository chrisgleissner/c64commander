import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnlineArchiveDialog } from "@/components/archive/OnlineArchiveDialog";
import { buildDefaultArchiveClientConfig } from "@/lib/archive/config";
import { reportUserError } from "@/lib/uiErrors";

vi.mock("@/hooks/useOnlineArchive", () => ({
  useOnlineArchive: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <select disabled={disabled} value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
}));

const { useOnlineArchive } = await import("@/hooks/useOnlineArchive");

const defaultConfig = buildDefaultArchiveClientConfig();

const baseReturn = {
  clientType: "CommoserveClient",
  presets: [
    { type: "category", description: "Category", values: [{ aqlKey: "apps", name: "Apps" }] },
    { type: "sort", description: "Sort", values: [{ aqlKey: "name", name: "Name" }] },
    { type: "order", description: "Order", values: [{ aqlKey: "asc", name: "Ascending" }] },
  ],
  presetsLoading: false,
  resolvedConfig: {
    id: "archive-commoserve",
    name: "CommoServe",
    headers: {
      "Client-Id": "Commodore",
      "User-Agent": "Assembly Query",
    },
    enabled: true,
    host: "commoserve.files.commodore.net",
    clientId: "Commodore",
    userAgent: "Assembly Query",
    baseUrl: "http://commoserve.files.commodore.net",
  },
  cancel: vi.fn(),
  clearError: vi.fn(),
  search: vi.fn(),
  openEntries: vi.fn(),
  execute: vi.fn(),
};

describe("OnlineArchiveDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders search results and submits a query from form input", async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "results",
        params: { name: "joyride", category: "apps" },
        results: [
          { id: "100", category: 40, name: "Joyride", group: "Protovision", year: 2024, updated: "2024-03-14" },
        ],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.queryByText(/Overrides are active/i)).toBeNull();
    expect(screen.getByText("Joyride")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "demo" } });
    fireEvent.click(screen.getByRole("button", { name: /search archive/i }));

    await waitFor(() => {
      expect(baseReturn.search).toHaveBeenCalledWith(
        expect.objectContaining({ name: "demo", group: "", handle: "", event: "" }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Joyride Protovision/i }));
    expect(baseReturn.openEntries).toHaveBeenCalled();
  });

  it("maps preset selects back to empty values when the user chooses Any", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: { phase: "idle" },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "apps" } });
    fireEvent.change(selects[0], { target: { value: "__any__" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "demo" } });
    fireEvent.click(screen.getByRole("button", { name: /search archive/i }));

    expect(baseReturn.search).toHaveBeenCalledWith(expect.objectContaining({ name: "demo", category: "" }));
  });

  it("falls back to aql keys when a preset value has no display name", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      presets: [{ type: "category", description: "Category", values: [{ aqlKey: "apps" }] }],
      state: { phase: "idle" },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.getByRole("option", { name: "apps" })).toBeInTheDocument();
  });

  it("renders entry execution states and reports archive errors", async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      resolvedConfig: {
        id: "archive-commoserve",
        name: "CommoServe",
        headers: {
          "Client-Id": "Custom",
          "User-Agent": "Custom UA",
        },
        enabled: true,
        host: "127.0.0.1:3001",
        clientId: "Custom",
        userAgent: "Custom UA",
        baseUrl: "http://127.0.0.1:3001",
      },
      state: {
        phase: "executing",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride" },
        results: [{ id: "100", category: 40, name: "Joyride" }],
        entry: { id: 0, path: "joyride.prg", size: 3, date: 1710374400000 },
        entries: [{ id: 0, path: "joyride.prg", size: 3, date: 1710374400000 }],
      },
    } as never);

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={buildDefaultArchiveClientConfig({
          hostOverride: "127.0.0.1:3001",
          clientIdOverride: "Custom",
          userAgentOverride: "Custom UA",
        })}
      />,
    );

    expect(screen.getByText(/Overrides are active/i)).toBeInTheDocument();
    expect(screen.getByText("joyride.prg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Executing…/i })).toBeDisabled();
  });

  it("reports archive errors from the hook", async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "error",
        message: "Archive failed",
        recoverableState: null,
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "ONLINE_ARCHIVE", description: "Archive failed" }),
      );
    });
  });

  it("does not report archive errors while the dialog is closed", async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "error",
        message: "Archive failed",
        recoverableState: null,
      },
    } as never);

    render(<OnlineArchiveDialog open={false} onOpenChange={() => undefined} config={defaultConfig} />);

    await waitFor(() => {
      expect(reportUserError).not.toHaveBeenCalled();
    });
  });

  it("clears an archive error when the dialog closes", async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "error",
        message: "Archive failed",
        recoverableState: null,
      },
    } as never);

    const { rerender } = render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    rerender(<OnlineArchiveDialog open={false} onOpenChange={() => undefined} config={defaultConfig} />);

    await waitFor(() => {
      expect(baseReturn.clearError).toHaveBeenCalled();
    });
  });

  it("keeps the selected result visible while entries are loading", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "loadingEntries",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride", group: "Protovision" },
        results: [{ id: "100", category: 40, name: "Joyride", group: "Protovision" }],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.getByText("Joyride")).toBeInTheDocument();
    expect(screen.getByText(/Loading entries…/i)).toBeInTheDocument();
    expect(screen.queryByText(/No executable files found/i)).toBeNull();
  });

  it("returns to results with the current form when entry loading is still in progress", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "loadingEntries",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride", group: "Protovision" },
        results: [{ id: "100", category: 40, name: "Joyride", group: "Protovision" }],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "new search" } });
    fireEvent.click(screen.getByRole("button", { name: "Results" }));

    expect(baseReturn.search).toHaveBeenCalledWith(expect.objectContaining({ name: "new search" }));
  });

  it("shows the empty results state before a search", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: { phase: "idle" },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.getByText(/Search results appear here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search archive/i })).toBeDisabled();
  });

  it("uses the current form when opening results outside the results phase and shows result fallbacks", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "idle",
        results: [{ id: "100", category: 40, name: "Joyride" }],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "fresh form" } });
    fireEvent.click(screen.getByRole("button", { name: /Joyride Unknown group/i }));

    expect(screen.getByText(/Unknown group • Unknown year • No update date/i)).toBeInTheDocument();
    expect(baseReturn.openEntries).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fresh form" }),
      expect.objectContaining({ id: "100" }),
      expect.any(Array),
    );
  });

  it("shows the searching state on the submit button", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: { phase: "searching" },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.getByRole("button", { name: /Search archive/i })).toBeDisabled();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows the empty entries state and lets the user return to results", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "entries",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride", group: "Protovision" },
        results: [{ id: "100", category: 40, name: "Joyride", group: "Protovision" }],
        entries: [],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.getByText(/No executable files found/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Results" }));
    expect(baseReturn.search).toHaveBeenCalledWith({ name: "joyride", category: "apps" });
  });

  it("shows downloading progress on the active entry", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "downloading",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride", group: "Protovision" },
        results: [{ id: "100", category: 40, name: "Joyride", group: "Protovision" }],
        entry: { id: 0, path: "joyride.prg", size: 3, date: 1710374400000 },
        entries: [{ id: 0, path: "joyride.prg", size: 3, date: 1710374400000 }],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.getByRole("button", { name: /Downloading…/i })).toBeDisabled();
  });

  it("shows the default action label and executes with the current form outside entry phases", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "loadingEntries",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride", group: "Protovision" },
        results: [{ id: "100", category: 40, name: "Joyride", group: "Protovision" }],
        entries: [{ id: 0, path: "joyride.prg", size: 3, date: 1710374400000 }],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "fresh form" } });
    const actionButton = screen.getByRole("button", { name: /^Run$/i });
    fireEvent.click(actionButton);

    expect(baseReturn.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fresh form" }),
      expect.objectContaining({ id: "100" }),
      expect.any(Array),
      expect.objectContaining({ id: 0, path: "joyride.prg" }),
      expect.any(Array),
    );
  });

  it("executes entries with the archived search params once entry results are loaded", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "entries",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride", group: "Protovision" },
        results: [{ id: "100", category: 40, name: "Joyride", group: "Protovision" }],
        entries: [{ id: 0, path: "joyride.prg", size: 3, date: 1710374400000 }],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "fresh form" } });
    fireEvent.click(screen.getByRole("button", { name: /^Run$/i }));

    expect(baseReturn.execute).toHaveBeenCalledWith(
      { name: "joyride", category: "apps" },
      expect.objectContaining({ id: "100" }),
      expect.any(Array),
      expect.objectContaining({ id: 0, path: "joyride.prg" }),
      expect.any(Array),
    );
  });

  it("shows a metadata fallback when an entry has no size or date", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: {
        phase: "entries",
        params: { name: "joyride", category: "apps" },
        result: { id: "100", category: 40, name: "Joyride", group: "Protovision" },
        results: [{ id: "100", category: 40, name: "Joyride", group: "Protovision" }],
        entries: [{ id: 0, path: "joyride.prg" }],
      },
    } as never);

    render(<OnlineArchiveDialog open onOpenChange={() => undefined} config={defaultConfig} />);

    expect(screen.getByText("No metadata")).toBeInTheDocument();
  });
});
