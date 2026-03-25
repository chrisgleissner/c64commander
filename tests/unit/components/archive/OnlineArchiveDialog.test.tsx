import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnlineArchiveDialog } from "@/components/archive/OnlineArchiveDialog";
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

const baseReturn = {
  clientType: "CommoserveClient",
  presets: [
    { type: "category", description: "Category", values: [{ aqlKey: "apps", name: "Apps" }] },
    { type: "sort", description: "Sort", values: [{ aqlKey: "name", name: "Name" }] },
    { type: "order", description: "Order", values: [{ aqlKey: "asc", name: "Ascending" }] },
  ],
  presetsLoading: false,
  resolvedConfig: {
    backend: "commodore",
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

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: "commodore", hostOverride: "", clientIdOverride: "", userAgentOverride: "" }}
      />,
    );

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

  it("renders entry execution states and reports archive errors", async () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      resolvedConfig: {
        backend: "commodore",
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
        config={{
          backend: "commodore",
          hostOverride: "127.0.0.1:3001",
          clientIdOverride: "Custom",
          userAgentOverride: "Custom UA",
        }}
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

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: "commodore", hostOverride: "", clientIdOverride: "", userAgentOverride: "" }}
      />,
    );

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

    render(
      <OnlineArchiveDialog
        open={false}
        onOpenChange={() => undefined}
        config={{ backend: "commodore", hostOverride: "", clientIdOverride: "", userAgentOverride: "" }}
      />,
    );

    await waitFor(() => {
      expect(reportUserError).not.toHaveBeenCalled();
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

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: "commodore", hostOverride: "", clientIdOverride: "", userAgentOverride: "" }}
      />,
    );

    expect(screen.getByText("Joyride")).toBeInTheDocument();
    expect(screen.getByText(/Loading entries…/i)).toBeInTheDocument();
    expect(screen.queryByText(/No executable files found/i)).toBeNull();
  });

  it("shows the empty results state before a search", () => {
    vi.mocked(useOnlineArchive).mockReturnValue({
      ...baseReturn,
      state: { phase: "idle" },
    } as never);

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: "commodore", hostOverride: "", clientIdOverride: "", userAgentOverride: "" }}
      />,
    );

    expect(screen.getByText(/Search results appear here/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search archive/i })).toBeDisabled();
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

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: "commodore", hostOverride: "", clientIdOverride: "", userAgentOverride: "" }}
      />,
    );

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

    render(
      <OnlineArchiveDialog
        open
        onOpenChange={() => undefined}
        config={{ backend: "commodore", hostOverride: "", clientIdOverride: "", userAgentOverride: "" }}
      />,
    );

    expect(screen.getByRole("button", { name: /Downloading…/i })).toBeDisabled();
  });
});
